const fs = require("fs/promises");
const path = require("path");
const { DATA_FILE } = require("../config");

const EMPTY_DB = {
  tasks: [],
  users: [],
  histories: {},
  events: []
};

class JsonStore {
  constructor(filePath = DATA_FILE) {
    this.filePath = filePath;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch (error) {
      await this.write(EMPTY_DB);
    }
  }

  async read() {
    await this.init();
    const content = await fs.readFile(this.filePath, "utf8");
    const data = JSON.parse(content || "{}");
    return {
      tasks: data.tasks || [],
      users: data.users || [],
      histories: data.histories || {},
      events: data.events || []
    };
  }

  async write(data) {
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  async update(mutator) {
    const current = await this.read();
    const next = await mutator(current);
    await this.write(next);
    return next;
  }

  async getUserByOpenid(openid) {
    const db = await this.read();
    return (db.users || []).find((item) => item.openid === openid) || null;
  }

  async getUsersByOpenids(openids) {
    const ids = new Set((openids || []).filter(Boolean));
    if (!ids.size) {
      return {};
    }

    const db = await this.read();
    const result = {};
    for (const item of db.users || []) {
      if (ids.has(item.openid)) {
        result[item.openid] = item;
      }
    }
    return result;
  }

  async writeUser(user) {
    await this.update((db) => ({
      ...db,
      users: [
        user,
        ...(db.users || []).filter((item) => item.openid !== user.openid)
      ]
    }));
    return user;
  }
}

module.exports = {
  JsonStore
};
