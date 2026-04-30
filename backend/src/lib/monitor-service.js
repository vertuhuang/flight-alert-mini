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
const { getCityByCode } = require("./airports");

class MonitorService {
  constructor({ store, provider, notifier, wxSubscribeNotifier }) {
    this.store = store;
    this.provider = provider;
    this.notifier = notifier;
    this.wxSubscribeNotifier = wxSubscribeNotifier;
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
    return db.tasks
      .sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .map((task) => {
        const histories = db.histories[task.id] || [];
        const lastHistory = histories[0];
        // 从历史记录中计算最近一次价格变动
        let latestChange = null;
        for (let i = 0; i < histories.length - 1; i++) {
          const current = histories[i];
          const previous = histories[i + 1];
          const currentPrice = current.summary?.minPrice;
          const previousPrice = previous.summary?.minPrice;
          if (currentPrice != null && previousPrice != null && currentPrice !== previousPrice) {
            const delta = currentPrice - previousPrice;
            latestChange = {
              checkedAt: current.checkedAt,
              type: delta < 0 ? "drop" : "rise",
              delta: Math.abs(delta),
              currentPrice,
              previousPrice
            };
            break;
          }
        }
        return {
          ...task,
          lastPriceChangeAt: latestChange?.checkedAt || lastHistory?.checkedAt || null,
          latestChange
        };
      });
  }

  async getTask(id) {
    const db = await this.store.read();
    return db.tasks.find((task) => task.id === id) || null;
  }

  async getHistory(id) {
    const db = await this.store.read();
    const items = db.histories[id] || [];
    return [...items].reverse();
  }

  async getEvents({ taskId, limit = 50 } = {}) {
    const db = await this.store.read();
    let events = db.events || [];
    if (taskId) {
      events = events.filter((e) => e.taskId === taskId);
    }
    // Enrich with task names
    const taskMap = {};
    for (const task of db.tasks) {
      taskMap[task.id] = task.name;
    }
    return events.slice(0, limit).map((e) => ({
      ...e,
      taskName: taskMap[e.taskId] || e.taskId
    }));
  }

  async clearUnread(id) {
    const db = await this.store.read();
    const task = db.tasks.find((item) => item.id === id);
    if (!task) return null;

    const updated = { ...task, unreadEvents: 0, updatedAt: isoNow() };
    await this.store.update((nextDb) => ({
      ...nextDb,
      tasks: nextDb.tasks.map((item) => (item.id === id ? updated : item))
    }));
    return updated;
  }

  /**
   * 增加订阅消息配额
   * 用户每次授权订阅消息时调用
   */
  async addSubscribeQuota(id, amount = 1) {
    const db = await this.store.read();
    const task = db.tasks.find((item) => item.id === id);
    if (!task) return null;

    const updated = {
      ...task,
      subscribeQuota: (task.subscribeQuota || 0) + amount,
      updatedAt: isoNow()
    };

    await this.store.update((nextDb) => ({
      ...nextDb,
      tasks: nextDb.tasks.map((item) => (item.id === id ? updated : item))
    }));

    return updated;
  }

  async stopAllTasks() {
    const db = await this.store.read();
    const now = isoNow();
    
    const updatedTasks = db.tasks.map((task) => ({
      ...task,
      active: false,
      updatedAt: now
    }));

    await this.store.update((nextDb) => ({
      ...nextDb,
      tasks: updatedTasks
    }));

    return { stoppedCount: db.tasks.length };
  }

  /**
   * 消费订阅消息配额
   * 发送订阅消息成功后调用
   * @returns {boolean} 是否消费成功
   */
  async consumeSubscribeQuota(id) {
    const db = await this.store.read();
    const task = db.tasks.find((item) => item.id === id);
    if (!task || !task.subscribeQuota || task.subscribeQuota <= 0) {
      return false;
    }

    const updated = {
      ...task,
      subscribeQuota: task.subscribeQuota - 1,
      updatedAt: isoNow()
    };

    await this.store.update((nextDb) => ({
      ...nextDb,
      tasks: nextDb.tasks.map((item) => (item.id === id ? updated : item))
    }));

    return true;
  }

  async deleteTask(id) {
    const db = await this.store.read();
    const task = db.tasks.find((item) => item.id === id);
    if (!task) return null;

    await this.store.update((nextDb) => ({
      ...nextDb,
      tasks: nextDb.tasks.filter((item) => item.id !== id),
      histories: {
        ...nextDb.histories,
        [id]: undefined
      },
      events: nextDb.events.filter((item) => item.taskId !== id)
    }));
    return task;
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
    const targetPrice = input.targetPrice == null ? null : Number(input.targetPrice);
    const notifyOnDrop = input.notifyOnDrop == null ? true : Boolean(input.notifyOnDrop);

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

    if (targetPrice !== null && (Number.isNaN(targetPrice) || targetPrice <= 0)) {
      throw new Error("目标价格必须是正数");
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
      targetPrice,
      notifyOnDrop,
      pushplusToken: String(input.pushplusToken || "").trim(),
      openid: String(input.openid || "").trim(),
      subscribeEnabled: input.subscribeEnabled == null ? false : Boolean(input.subscribeEnabled),
      active: input.active == null ? true : Boolean(input.active)
    };
  }

  async createTask(input) {
    const payload = this.validateTaskInput(input);
    const now = isoNow();
    const initialSubscribeQuota = Math.max(0, Number(input.subscribeQuota || 0));

    const task = {
      id: createId("task"),
      ...payload,
      baseline: {},
      latestSnapshot: null,
      latestSummary: null,
      lastError: null,
      lastCheckedAt: null,
      nextCheckAt: now,
      unreadEvents: 0,
      subscribeQuota: initialSubscribeQuota,
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

    // 首次检查价格并发送创建通知
    const hasPushPlus = !!task.pushplusToken;
    const hasSubscribe = !!task.openid && task.subscribeEnabled;
    if (hasPushPlus || hasSubscribe) {
      this.#initialCheckAndNotify(task).catch((err) => {
        console.error("initial check error", err);
      });
    } else {
      // 没有通知渠道也执行检查，只是不发送通知
      this.checkTask(task.id).catch((err) => {
        console.error("initial check error", err);
      });
    }

    return task;
  }

  async #initialCheckAndNotify(task) {
    try {
      const snapshot = await this.provider.fetchPrices(task);
      const summary = buildSummaryFromSnapshot(snapshot);
      const checkedAt = isoNow();
      const nextCheckAt = new Date(
        Date.now() + task.checkIntervalSec * 1000
      ).toISOString();

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

      // 发送创建任务通知
      const notifyResults = [];
      const fromCity = getCityByCode(task.placeFrom);
      const toCity = getCityByCode(task.placeTo);
      const dateText = task.departDates.map((d) => `${d.slice(4, 6)}月${d.slice(6, 8)}日`).join("、");
      const title = `${fromCity}飞${toCity}票价监控已创建`;
      const content = `${dateText}${fromCity}飞${toCity} 当前最低价${summary?.minPrice || "暂无"}元`;

      // PushPlus 通知
      if (task.pushplusToken) {
        const ppResult = await this.notifier.send({
          token: task.pushplusToken,
          title,
          content
        });
        notifyResults.push({ channel: "pushplus", result: ppResult });
      }

      // 微信订阅消息通知（检查配额）
      if (task.openid && task.subscribeEnabled && task.subscribeQuota > 0 && this.wxSubscribeNotifier) {
        const { WxSubscribeNotifier } = require("./wx-subscribe-notifier");
        const fromCity = getCityByCode(task.placeFrom);
        const toCity = getCityByCode(task.placeTo);
        const subscribeData = WxSubscribeNotifier.buildTaskCreatedData(task, summary, fromCity, toCity);
        const wxResult = await this.wxSubscribeNotifier.send({
          openid: task.openid,
          data: subscribeData,
          page: `pages/task-detail/task-detail?id=${task.id}`
        });
        // 发送成功后消耗配额
        if (wxResult && wxResult.errcode === 0) {
          await this.consumeSubscribeQuota(task.id);
        }
        notifyResults.push({ channel: "wxsubscribe", result: wxResult, quotaConsumed: wxResult?.errcode === 0 });
      }

      await this.store.update((nextDb) => ({
        ...nextDb,
        tasks: nextDb.tasks.map((item) =>
          item.id === task.id ? updatedTask : item
        )
      }));

      return { task: updatedTask, notifyResults };
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
          item.id === task.id ? failedTask : item
        )
      }));

      throw error;
    }
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
      baseline: current.baseline || {},
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
      const changes = this.#compareSnapshot(task, snapshot, db.histories[task.id] || []);
      const checkedAt = isoNow();
      const summary = buildSummaryFromSnapshot(snapshot);
      const nextCheckAt = new Date(
        Date.now() + task.checkIntervalSec * 1000
      ).toISOString();

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

      // 仅当价格发生变化（或有初始基准）时才记录历史
      const shouldLogHistory = changes.length > 0;

      // Filter changes for notification based on strategy
      const notifyChanges = changes.filter((change) => {
        if (change.type === "initial") return false;

        // 目标价格触发：价格下降到目标价以下（无论是否开启仅降价通知）
        if (task.targetPrice && change.type === "drop" && change.current <= task.targetPrice) {
          return true;
        }

        // notifyOnDrop: only notify on price drops
        if (task.notifyOnDrop && change.type === "rise") return false;

        return true;
      });

      const notifyResults = [];
      // PushPlus 通知
      if (notifyChanges.length > 0 && task.pushplusToken) {
        const fromCity = getCityByCode(task.placeFrom);
        const toCity = getCityByCode(task.placeTo);
        // 取第一个变动作为代表
        const firstChange = notifyChanges[0];
        const isDrop = firstChange.type === "drop";
        const title = `${fromCity}飞${toCity}机票${isDrop ? "降价" : "涨价"}了`;
        const dateText = task.departDates.map((d) => `${d.slice(4, 6)}月${d.slice(6, 8)}日`).join("、");
        const content = `${dateText} ${fromCity}飞${toCity}当前最低价${summary?.minPrice || firstChange.current}元，比上次${isDrop ? "跌" : "涨"}了${Math.abs(firstChange.delta)}元`;
        const result = await this.notifier.send({
          token: task.pushplusToken,
          title,
          content
        });
        notifyResults.push({ channel: "pushplus", result });
      }

      // 微信订阅消息通知（检查配额）
      if (notifyChanges.length > 0 && task.openid && task.subscribeEnabled && task.subscribeQuota > 0 && this.wxSubscribeNotifier) {
        const { WxSubscribeNotifier } = require("./wx-subscribe-notifier");
        const fromCity = getCityByCode(task.placeFrom);
        const toCity = getCityByCode(task.placeTo);
        const subscribeData = WxSubscribeNotifier.buildPriceChangeData(task, notifyChanges, fromCity, toCity);
        const wxResult = await this.wxSubscribeNotifier.send({
          openid: task.openid,
          data: subscribeData,
          page: `pages/task-detail/task-detail?id=${task.id}`
        });
        // 发送成功后消耗配额
        if (wxResult && wxResult.errcode === 0) {
          await this.consumeSubscribeQuota(task.id);
        }
        notifyResults.push({ channel: "wxsubscribe", result: wxResult, quotaConsumed: wxResult?.errcode === 0 });
      }

      // Update unreadEvents count
      const unreadDelta = notifyChanges.length > 0 ? 1 : 0;
      updatedTask.unreadEvents = (task.unreadEvents || 0) + unreadDelta;

      await this.store.update((nextDb) => {
        const newHistories = shouldLogHistory
          ? {
              ...nextDb.histories,
              [id]: [
                {
                  id: createId("history"),
                  taskId: id,
                  checkedAt,
                  summary,
                  changes,
                  snapshot
                },
                ...(nextDb.histories[id] || [])
              ].slice(0, 50)
            }
          : nextDb.histories;

        const newEvents = shouldLogHistory
          ? [
              {
                id: createId("event"),
                taskId: id,
                createdAt: checkedAt,
                changes,
                notifyResults,
                notified: notifyChanges.length > 0
              },
              ...nextDb.events
            ].slice(0, 200)
          : nextDb.events;

        return {
          ...nextDb,
          tasks: nextDb.tasks.map((item) => (item.id === id ? updatedTask : item)),
          histories: newHistories,
          events: newEvents
        };
      });

      return {
        task: updatedTask,
        changes,
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

  #compareSnapshot(task, snapshot, histories = []) {
    const baseline = task.baseline || {};
    
    // 收集历史记录中已经出现过的所有 key（用于过滤重复的"首次"）
    const seenKeys = new Set();
    for (const history of histories) {
      for (const change of history.changes || []) {
        if (change.key) {
          seenKeys.add(change.key);
        }
      }
    }
    
    const changes = [];

    if (snapshot.flightWay === "Roundtrip") {
      for (const [departDate, returnMap] of Object.entries(snapshot.prices || {})) {
        for (const [returnDate, price] of Object.entries(returnMap)) {
          const key = `${departDate}_${returnDate}`;
          const previous = baseline[key];
          // 如果历史记录中已经有过这个 key，就不再标记为"首次"
          if (previous == null && !seenKeys.has(key)) {
            changes.push({
              type: "initial",
              key,
              label: `${formatDateCode(departDate)} -> ${formatDateCode(returnDate)}`,
              previous: null,
              current: price,
              delta: null
            });
            seenKeys.add(key);
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
      // 如果历史记录中已经有过这个 key，就不再标记为"首次"
      if (previous == null && !seenKeys.has(date)) {
        changes.push({
          type: "initial",
          key: date,
          label: formatDateCode(date),
          previous: null,
          current,
          delta: null
        });
        seenKeys.add(date);
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

  #buildMergedNotification(task, changes) {
    const fromCity = getCityByCode(task.placeFrom);
    const toCity = getCityByCode(task.placeTo);
    const wayLabel = task.flightWay === "Roundtrip" ? "往返" : "单程";

    const lines = [
      `任务名称：${task.name}`,
      `航线：${fromCity} → ${toCity} (${wayLabel})`
    ];

    for (const change of changes) {
      const trend = change.type === "drop" ? "下降" : "上涨";
      lines.push(`${change.label}`);
      lines.push(`变动：${trend} ${Math.abs(change.delta)}元`);
      lines.push(`当前：${change.current}元`);
      lines.push(`之前：${change.previous}元`);
    }

    if (task.targetPrice) {
      lines.push(`目标价：${task.targetPrice}元`);
    }

    lines.push(`下次检查：${task.checkIntervalSec}秒后`);

    return lines.join("\r\n");
  }

  #buildCreateNotification(task, summary) {
    const fromCity = getCityByCode(task.placeFrom);
    const toCity = getCityByCode(task.placeTo);
    const wayLabel = task.flightWay === "Roundtrip" ? "往返" : "单程";
    const minPrice = summary?.minPrice || "暂无";

    const lines = [
      `任务名称：${task.name}`,
      `航线：${fromCity} → ${toCity} (${wayLabel})`,
      `当前最低价：${minPrice}元`,
      `出发日期：${task.departDates.map((d) => `${d.slice(4, 6)}月${d.slice(6, 8)}日`).join("、")}`
    ];

    if (task.flightWay === "Roundtrip" && task.returnDates?.length) {
      lines.push(`返程日期：${task.returnDates.map((d) => `${d.slice(4, 6)}月${d.slice(6, 8)}日`).join("、")}`);
    }

    if (task.targetPrice) {
      lines.push(`目标价：${task.targetPrice}元`);
    }

    lines.push(`变动阈值：${task.threshold}元`);
    lines.push(`检查间隔：${task.checkIntervalSec}秒`);

    return lines.join("\r\n");
  }
}

module.exports = {
  MonitorService
};
