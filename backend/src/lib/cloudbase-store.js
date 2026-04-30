const {
  CLOUDBASE_ENV_ID,
  EVENTS_COLLECTION,
  HISTORIES_COLLECTION,
  TASKS_COLLECTION
} = require("../config");

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
      this.initialized = true;
    } catch (error) {
      console.error("CloudBaseStore init failed:", error.message);
      throw error;
    }
  }

  async read() {
    await this.init();

    try {
      const [tasksRes, historiesRes, eventsRes] = await Promise.all([
        this.db.collection(TASKS_COLLECTION).limit(1000).get(),
        this.db.collection(HISTORIES_COLLECTION).limit(1000).get(),
        this.db.collection(EVENTS_COLLECTION).limit(1000).get()
      ]);

      const tasks = (tasksRes.data || [])
        .map(stripDocumentMeta)
        .sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
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

  async listTasks() {
    await this.init();
    const res = await this.db
      .collection(TASKS_COLLECTION)
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

  async writeTask(task) {
    await this.init();
    await this.db.collection(TASKS_COLLECTION).doc(task.id).set(task);
    return task;
  }

  async getHistory(taskId, { limit = 50 } = {}) {
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

  async appendHistory(taskId, item, { limit = 50 } = {}) {
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
