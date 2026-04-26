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
}

module.exports = {
  CloudBaseStore
};
