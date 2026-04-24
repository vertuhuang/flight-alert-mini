const fs = require("fs/promises");
const path = require("path");
const { DATA_FILE } = require("../config");

const EMPTY_DB = {
  tasks: [],
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
}

module.exports = {
  JsonStore
};
