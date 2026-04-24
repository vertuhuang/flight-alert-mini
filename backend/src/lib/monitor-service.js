const {
  DEFAULT_CHECK_INTERVAL_SEC,
  DEFAULT_THRESHOLD,
  SCHEDULER_TICK_MS
} = require("../config");
const {
  buildSummaryFromSnapshot,
  createId,
  formatDateCode,
  isValidDateCode,
  isoNow,
  normalizeDateList
} = require("./utils");

class MonitorService {
  constructor({ store, provider, notifier }) {
    this.store = store;
    this.provider = provider;
    this.notifier = notifier;
    this.timer = null;
    this.isChecking = false;
  }

  async init() {
    await this.store.init();
    this.startScheduler();
  }

  startScheduler() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.runDueChecks().catch((error) => {
        console.error("scheduler error", error);
      });
    }, SCHEDULER_TICK_MS);
  }

  async runDueChecks() {
    if (this.isChecking) {
      return;
    }

    this.isChecking = true;
    try {
      const db = await this.store.read();
      const now = Date.now();
      const dueTasks = db.tasks.filter(
        (task) =>
          task.active &&
          (!task.nextCheckAt || new Date(task.nextCheckAt).getTime() <= now)
      );

      for (const task of dueTasks) {
        await this.checkTask(task.id);
      }
    } finally {
      this.isChecking = false;
    }
  }

  async listTasks() {
    const db = await this.store.read();
    return db.tasks.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async getTask(id) {
    const db = await this.store.read();
    return db.tasks.find((task) => task.id === id) || null;
  }

  async getHistory(id) {
    const db = await this.store.read();
    return db.histories[id] || [];
  }

  validateTaskInput(input, { partial = false } = {}) {
    const flightWay = input.flightWay || "Oneway";
    const departDates = normalizeDateList(input.departDates);
    const returnDates = normalizeDateList(input.returnDates);
    const threshold = Number(
      input.threshold == null ? DEFAULT_THRESHOLD : input.threshold
    );
    const checkIntervalSec = Number(
      input.checkIntervalSec == null
        ? DEFAULT_CHECK_INTERVAL_SEC
        : input.checkIntervalSec
    );

    if (!partial || input.name != null) {
      if (!String(input.name || "").trim()) {
        throw new Error("任务名称不能为空");
      }
    }

    if (!partial || input.placeFrom != null) {
      if (!/^[A-Za-z]{3}$/.test(String(input.placeFrom || "").trim())) {
        throw new Error("出发机场代码必须是 3 位 IATA 代码");
      }
    }

    if (!partial || input.placeTo != null) {
      if (!/^[A-Za-z]{3}$/.test(String(input.placeTo || "").trim())) {
        throw new Error("到达机场代码必须是 3 位 IATA 代码");
      }
    }

    if (!["Oneway", "Roundtrip"].includes(flightWay)) {
      throw new Error("flightWay 仅支持 Oneway 或 Roundtrip");
    }

    if (!partial || input.departDates != null) {
      if (!departDates.length || departDates.some((item) => !isValidDateCode(item))) {
        throw new Error("departDates 必须是 YYYYMMDD 格式的非空列表");
      }
    }

    if (flightWay === "Roundtrip" && (!partial || input.returnDates != null)) {
      if (!returnDates.length || returnDates.some((item) => !isValidDateCode(item))) {
        throw new Error("往返票任务必须提供 returnDates");
      }
    }

    if (Number.isNaN(threshold) || threshold <= 0) {
      throw new Error("threshold 必须是正数");
    }

    if (Number.isNaN(checkIntervalSec) || checkIntervalSec < 30) {
      throw new Error("checkIntervalSec 不能小于 30 秒");
    }

    return {
      name: String(input.name || "").trim(),
      placeFrom: String(input.placeFrom || "").trim().toUpperCase(),
      placeTo: String(input.placeTo || "").trim().toUpperCase(),
      flightWay,
      departDates,
      returnDates,
      threshold,
      checkIntervalSec,
      pushplusToken: String(input.pushplusToken || "").trim(),
      active: input.active == null ? true : Boolean(input.active)
    };
  }

  async createTask(input) {
    const payload = this.validateTaskInput(input);
    const now = isoNow();

    const task = {
      id: createId("task"),
      ...payload,
      baseline: {},
      latestSnapshot: null,
      latestSummary: null,
      lastError: null,
      lastCheckedAt: null,
      nextCheckAt: now,
      createdAt: now,
      updatedAt: now
    };

    await this.store.update((db) => ({
      ...db,
      tasks: [task, ...db.tasks],
      histories: {
        ...db.histories,
        [task.id]: []
      }
    }));

    return task;
  }

  async updateTask(id, patch) {
    const db = await this.store.read();
    const current = db.tasks.find((item) => item.id === id);

    if (!current) {
      return null;
    }

    const mergedInput = {
      ...current,
      ...patch
    };
    const payload = this.validateTaskInput(mergedInput, { partial: true });
    const updated = {
      ...current,
      ...payload,
      updatedAt: isoNow()
    };

    if (patch.active === true && !current.active) {
      updated.nextCheckAt = isoNow();
    }

    await this.store.update((nextDb) => ({
      ...nextDb,
      tasks: nextDb.tasks.map((item) => (item.id === id ? updated : item))
    }));

    return updated;
  }

  async checkTask(id) {
    const db = await this.store.read();
    const task = db.tasks.find((item) => item.id === id);

    if (!task) {
      throw new Error("task_not_found");
    }

    try {
      const snapshot = await this.provider.fetchPrices(task);
      const changes = this.#compareSnapshot(task, snapshot);
      const checkedAt = isoNow();
      const summary = buildSummaryFromSnapshot(snapshot);
      const nextCheckAt = new Date(
        Date.now() + task.checkIntervalSec * 1000
      ).toISOString();

      const historyItem = {
        id: createId("history"),
        taskId: id,
        checkedAt,
        summary,
        changes,
        snapshot
      };

      const updatedTask = {
        ...task,
        baseline: this.#buildBaseline(snapshot),
        latestSnapshot: snapshot,
        latestSummary: summary,
        lastError: null,
        lastCheckedAt: checkedAt,
        nextCheckAt,
        updatedAt: checkedAt
      };

      const notifyResults = [];
      for (const change of changes) {
        if (change.type === "initial") {
          continue;
        }

        const title = "机票价格提醒";
        const content = this.#buildNotificationMessage(task, change);
        const result = await this.notifier.send({
          token: task.pushplusToken,
          title,
          content
        });
        notifyResults.push({ change, result });
      }

      await this.store.update((nextDb) => ({
        ...nextDb,
        tasks: nextDb.tasks.map((item) => (item.id === id ? updatedTask : item)),
        histories: {
          ...nextDb.histories,
          [id]: [historyItem, ...(nextDb.histories[id] || [])].slice(0, 50)
        },
        events: [
          {
            id: createId("event"),
            taskId: id,
            createdAt: checkedAt,
            changes,
            notifyResults
          },
          ...nextDb.events
        ].slice(0, 200)
      }));

      return {
        task: updatedTask,
        historyItem,
        notifyResults
      };
    } catch (error) {
      const failedTask = {
        ...task,
        lastError: error.message,
        lastCheckedAt: isoNow(),
        nextCheckAt: new Date(
          Date.now() + Math.min(task.checkIntervalSec, 120) * 1000
        ).toISOString(),
        updatedAt: isoNow()
      };

      await this.store.update((nextDb) => ({
        ...nextDb,
        tasks: nextDb.tasks.map((item) =>
          item.id === id ? failedTask : item
        )
      }));

      throw error;
    }
  }

  #buildBaseline(snapshot) {
    if (snapshot.flightWay === "Roundtrip") {
      const matrixBaseline = {};
      for (const [departDate, returnMap] of Object.entries(snapshot.prices || {})) {
        for (const [returnDate, price] of Object.entries(returnMap)) {
          matrixBaseline[`${departDate}_${returnDate}`] = price;
        }
      }
      return matrixBaseline;
    }

    const baseline = {};
    for (const [date, item] of Object.entries(snapshot.prices || {})) {
      baseline[date] = item.best;
    }
    return baseline;
  }

  #compareSnapshot(task, snapshot) {
    const baseline = task.baseline || {};
    const changes = [];

    if (snapshot.flightWay === "Roundtrip") {
      for (const [departDate, returnMap] of Object.entries(snapshot.prices || {})) {
        for (const [returnDate, price] of Object.entries(returnMap)) {
          const key = `${departDate}_${returnDate}`;
          const previous = baseline[key];
          if (previous == null) {
            changes.push({
              type: "initial",
              key,
              label: `${formatDateCode(departDate)} -> ${formatDateCode(returnDate)}`,
              previous: null,
              current: price,
              delta: null
            });
            continue;
          }

          const delta = price - previous;
          if (Math.abs(delta) >= task.threshold) {
            changes.push({
              type: delta > 0 ? "rise" : "drop",
              key,
              label: `${formatDateCode(departDate)} -> ${formatDateCode(returnDate)}`,
              previous,
              current: price,
              delta
            });
          }
        }
      }

      return changes;
    }

    for (const [date, priceItem] of Object.entries(snapshot.prices || {})) {
      const previous = baseline[date];
      const current = priceItem.best;
      if (previous == null) {
        changes.push({
          type: "initial",
          key: date,
          label: formatDateCode(date),
          previous: null,
          current,
          delta: null
        });
        continue;
      }

      const delta = current - previous;
      if (Math.abs(delta) >= task.threshold) {
        changes.push({
          type: delta > 0 ? "rise" : "drop",
          key: date,
          label: formatDateCode(date),
          previous,
          current,
          delta
        });
      }
    }

    return changes;
  }

  #buildNotificationMessage(task, change) {
    const trend = change.type === "rise" ? "上涨" : "下降";
    return [
      `${task.name}`,
      `${task.placeFrom} -> ${task.placeTo}`,
      `${change.label} 价格${trend} ${Math.abs(change.delta)} 元`,
      `当前价格：${change.current} 元`,
      `上一价格：${change.previous} 元`
    ].join("\n");
  }
}

module.exports = {
  MonitorService
};
