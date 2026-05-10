const {
  CLOUDBASE_ENV_ID,
  EVENTS_COLLECTION,
  GOLD_CACHE_COLLECTION,
  HISTORIES_COLLECTION,
  TASKS_COLLECTION,
  USERS_COLLECTION
} = require("../config");

const ALL_COLLECTIONS = [
  TASKS_COLLECTION,
  USERS_COLLECTION,
  HISTORIES_COLLECTION,
  EVENTS_COLLECTION,
  GOLD_CACHE_COLLECTION
];

function stripDocumentMeta(item) {
  if (!item || typeof item !== "object") {
    return item;
  }

  const { _id, ...rest } = item;
  return rest;
}

function flattenHistories(histories) {
  return Object.entries(histories || {}).flatMap(([taskId, items]) =>
    (items || []).map((item) => ({
      ...item,
      taskId
    }))
  );
}

function normalizeDocResult(data) {
  if (Array.isArray(data)) {
    return data[0] || null;
  }
  return data || null;
}

class CloudBaseStore {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }

    try {
      const cloudbase = require("@cloudbase/node-sdk");
      const secretId = process.env.SECRET_ID;
      const secretKey = process.env.SECRET_KEY;

      const initOptions = {};

      if (secretId && secretKey) {
        initOptions.secretId = secretId;
        initOptions.secretKey = secretKey;
        if (CLOUDBASE_ENV_ID) {
          initOptions.env = CLOUDBASE_ENV_ID;
        }
        console.log(`CloudBaseStore initialized (explicit credentials, env: ${CLOUDBASE_ENV_ID || "default"})`);
      } else if (CLOUDBASE_ENV_ID) {
        initOptions.env = CLOUDBASE_ENV_ID;
        console.log(`CloudBaseStore initialized (env only, no explicit credentials)`);
      } else {
        initOptions.env = cloudbase.SYMBOL_CURRENT_ENV;
        console.log("CloudBaseStore initialized (SYMBOL_CURRENT_ENV)");
      }

      this.app = cloudbase.init(initOptions);
      this.db = this.app.database();

      // 自动创建缺失的集合（新环境部署后不会自动建表）
      await this.#ensureCollections();

      this.initialized = true;
    } catch (error) {
      console.error("CloudBaseStore init failed:", error.message);
      throw error;
    }
  }

  async #ensureCollections() {
    for (const name of ALL_COLLECTIONS) {
      try {
        await this.db.createCollection(name);
        console.log(`Created collection: ${name}`);
      } catch (error) {
        // 集合已存在或权限不足 — 静默跳过
        if (
          error.message &&
          (
            error.message.includes("already exists") ||
            error.message.includes("CollectionExist") ||
            error.message.includes("重复")
          )
        ) {
          console.log(`Collection already exists: ${name}`);
        } else {
          console.warn(`Failed to create collection ${name}: ${error.message} (non-fatal)`);
        }
      }
    }
  }

  async read() {
    await this.init();

    try {
      const [tasksRes, usersRes, historiesRes, eventsRes] = await Promise.all([
        this.db.collection(TASKS_COLLECTION).limit(1000).get(),
        this.db.collection(USERS_COLLECTION).limit(1000).get(),
        this.db.collection(HISTORIES_COLLECTION).limit(1000).get(),
        this.db.collection(EVENTS_COLLECTION).limit(1000).get()
      ]);

      const tasks = (tasksRes.data || [])
        .map(stripDocumentMeta)
        .sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

      const users = (usersRes.data || [])
        .map(stripDocumentMeta)
        .sort(
          (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
        );

      const histories = {};
      for (const item of historiesRes.data || []) {
        const history = stripDocumentMeta(item);
        const taskId = history.taskId;

        if (!taskId) {
          continue;
        }

        if (!histories[taskId]) {
          histories[taskId] = [];
        }

        histories[taskId].push({
          ...history,
          taskId: undefined
        });
      }

      for (const key of Object.keys(histories)) {
        histories[key] = histories[key].sort(
          (a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
        );
      }

      const events = (eventsRes.data || [])
        .map(stripDocumentMeta)
        .sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      return {
        tasks,
        users,
        histories,
        events
      };
    } catch (error) {
      console.error("CloudBaseStore.read failed:", error.message);
      throw error;
    }
  }

  async write(data) {
    await this.init();
    const current = await this.read();
    await this.#syncCollection(TASKS_COLLECTION, current.tasks, data.tasks || []);
    await this.#syncCollection(USERS_COLLECTION, current.users, data.users || []);
    await this.#syncCollection(
      HISTORIES_COLLECTION,
      flattenHistories(current.histories),
      flattenHistories(data.histories)
    );
    await this.#syncCollection(EVENTS_COLLECTION, current.events, data.events || []);
  }

  async update(mutator) {
    const current = await this.read();
    const next = await mutator(current);
    await this.write(next);
    return next;
  }

  async listTasks(openid) {
    await this.init();
    let query = this.db.collection(TASKS_COLLECTION);
    if (openid) {
      query = query.where({ openid });
    }
    const res = await query
      .orderBy("updatedAt", "desc")
      .limit(1000)
      .get();
    return (res.data || [])
      .map(stripDocumentMeta)
      .sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
  }

  async listDueTasks(nowIso, { limit = 1000 } = {}) {
    await this.init();
    const _ = this.db.command;
    const res = await this.db
      .collection(TASKS_COLLECTION)
      .where(
        _.and(
          {
            active: true
          },
          _.or(
            {
              nextCheckAt: _.lte(nowIso)
            },
            {
              nextCheckAt: _.exists(false)
            },
            {
              nextCheckAt: null
            }
          )
        )
      )
      .orderBy("nextCheckAt", "asc")
      .limit(limit)
      .get();

    return (res.data || []).map(stripDocumentMeta);
  }

  async getTask(id) {
    await this.init();
    try {
      const res = await this.db.collection(TASKS_COLLECTION).doc(id).get();
      return stripDocumentMeta(normalizeDocResult(res.data));
    } catch (error) {
      if (String(error.message || "").includes("does not exist")) {
        return null;
      }
      throw error;
    }
  }

  async getUserByOpenid(openid) {
    await this.init();
    const res = await this.db
      .collection(USERS_COLLECTION)
      .where({ openid })
      .limit(1)
      .get();
    return stripDocumentMeta(normalizeDocResult(res.data));
  }

  async getUsersByOpenids(openids) {
    await this.init();
    const ids = [...new Set((openids || []).filter(Boolean))];
    if (!ids.length) {
      return {};
    }

    const _ = this.db.command;
    const res = await this.db
      .collection(USERS_COLLECTION)
      .where({
        openid: _.in(ids)
      })
      .limit(1000)
      .get();

    const result = {};
    for (const item of res.data || []) {
      const user = stripDocumentMeta(item);
      if (user?.openid) {
        result[user.openid] = user;
      }
    }
    return result;
  }

  async writeUser(user) {
    await this.init();
    await this.db.collection(USERS_COLLECTION).doc(user.id).set(user);
    return user;
  }

  async writeTask(task) {
    await this.init();
    await this.db.collection(TASKS_COLLECTION).doc(task.id).set(task);
    return task;
  }

  async getHistory(taskId, { limit = 30 } = {}) {
    await this.init();
    const res = await this.db
      .collection(HISTORIES_COLLECTION)
      .where({ taskId })
      .orderBy("checkedAt", "desc")
      .limit(limit)
      .get();

    return (res.data || [])
      .map((item) => {
        const history = stripDocumentMeta(item);
        return {
          ...history,
          taskId: undefined
        };
      })
      .sort(
        (a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
      );
  }

  async getHistoriesByTaskIds(taskIds, { limit = 1000 } = {}) {
    await this.init();
    const ids = [...new Set((taskIds || []).filter(Boolean))];
    if (!ids.length) {
      return {};
    }

    const _ = this.db.command;
    const res = await this.db
      .collection(HISTORIES_COLLECTION)
      .where({
        taskId: _.in(ids)
      })
      .orderBy("checkedAt", "desc")
      .limit(limit)
      .get();

    const grouped = {};
    for (const item of res.data || []) {
      const history = stripDocumentMeta(item);
      const taskId = history.taskId;
      if (!taskId) {
        continue;
      }
      if (!grouped[taskId]) {
        grouped[taskId] = [];
      }
      grouped[taskId].push({
        ...history,
        taskId: undefined
      });
    }

    return grouped;
  }

  async appendHistory(taskId, item, { limit = 30 } = {}) {
    await this.init();
    await this.db.collection(HISTORIES_COLLECTION).doc(item.id).set({
      ...item,
      taskId
    });
    await this.#pruneOverflow(HISTORIES_COLLECTION, "checkedAt", { taskId }, limit);
  }

  async getEvents({ taskId, limit = 50 } = {}) {
    await this.init();
    let query = this.db.collection(EVENTS_COLLECTION);
    if (taskId) {
      query = query.where({ taskId });
    }

    const res = await query.orderBy("createdAt", "desc").limit(limit).get();
    return (res.data || [])
      .map(stripDocumentMeta)
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, limit);
  }

  async appendEvent(item, { limit = 200 } = {}) {
    await this.init();
    await this.db.collection(EVENTS_COLLECTION).doc(item.id).set(item);
    await this.#pruneOverflow(EVENTS_COLLECTION, "createdAt", null, limit);
  }

  async deleteTaskData(taskId) {
    await this.init();
    await this.db.collection(TASKS_COLLECTION).doc(taskId).remove();
    await this.#removeByFilter(HISTORIES_COLLECTION, { taskId });
    await this.#removeByFilter(EVENTS_COLLECTION, { taskId });
  }

  /**
   * 写入一条金价缓存记录，并按天修剪（每天最多保留 100 条，约 30min 一条 * 48 + 余量）
   */
  async writeGoldCache(item) {
    await this.init();
    await this.db.collection(GOLD_CACHE_COLLECTION).doc(item.id).set(item);
    // 保留最新的 100 条（约 2 天），按 fetchedAt 降序修剪
    await this.#pruneOverflow(GOLD_CACHE_COLLECTION, "fetchedAt", null, 100);
  }

  /**
   * 获取最新一条金价缓存记录
   * @returns {object|null}
   */
  async getLatestGoldCache() {
    await this.init();
    const res = await this.db
      .collection(GOLD_CACHE_COLLECTION)
      .orderBy("fetchedAt", "desc")
      .limit(1)
      .get();
    return stripDocumentMeta(normalizeDocResult(res.data));
  }

  async #syncCollection(collectionName, previousItems, nextItems) {
    const previousIds = new Set((previousItems || []).map((item) => item.id));
    const nextIds = new Set((nextItems || []).map((item) => item.id));

    for (const item of nextItems || []) {
      await this.db.collection(collectionName).doc(item.id).set(item);
    }

    for (const id of previousIds) {
      if (!nextIds.has(id)) {
        await this.db.collection(collectionName).doc(id).remove();
      }
    }
  }

  async #removeByFilter(collectionName, filter) {
    const res = await this.db.collection(collectionName).where(filter).limit(1000).get();
    for (const item of res.data || []) {
      const docId = item._id || item.id;
      if (docId) {
        await this.db.collection(collectionName).doc(docId).remove();
      }
    }
  }

  async #pruneOverflow(collectionName, sortField, filter, keepLimit) {
    let query = this.db.collection(collectionName);
    if (filter) {
      query = query.where(filter);
    }

    const res = await query.limit(1000).get();
    const overflow = (res.data || [])
      .sort(
        (a, b) => new Date(b[sortField]).getTime() - new Date(a[sortField]).getTime()
      )
      .slice(keepLimit);

    for (const item of overflow) {
      const docId = item._id || item.id;
      if (docId) {
        await this.db.collection(collectionName).doc(docId).remove();
      }
    }
  }
}

module.exports = {
  CloudBaseStore
};
