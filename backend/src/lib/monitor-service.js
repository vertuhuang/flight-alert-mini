const {
  DEFAULT_CHECK_INTERVAL_SEC,
  DEFAULT_THRESHOLD,
  SCHEDULER_TICK_MS,
  EXCHANGE_DEFAULT_CHECK_INTERVAL_SEC,
  EXCHANGE_DEFAULT_THRESHOLD,
  GOLD_DEFAULT_CHECK_INTERVAL_SEC,
  GOLD_DEFAULT_THRESHOLD
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

const HISTORY_RETENTION_LIMIT = 30;
const DEFAULT_SILENT_START = "00:00";
const DEFAULT_SILENT_END = "08:00";
const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

class MonitorService {
  constructor({ store, provider, notifier, wxSubscribeNotifier }) {
    this.store = store;
    this.provider = provider;
    this.notifier = notifier;
    this.wxSubscribeNotifier = wxSubscribeNotifier;
    this.timer = null;
    this.isChecking = false;
    this.taskCheckPromises = new Map();
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
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      let dueTasks;

      if (typeof this.store.listDueTasks === "function") {
        dueTasks = await this.store.listDueTasks(nowIso);
      } else {
        const tasks = typeof this.store.listTasks === "function"
          ? await this.store.listTasks()
          : (await this.store.read()).tasks;
        dueTasks = tasks.filter(
          (task) =>
            task.active &&
            (!task.nextCheckAt || new Date(task.nextCheckAt).getTime() <= now)
        );
      }

      const openids = [...new Set(dueTasks.map((task) => task.openid).filter(Boolean))];
      const usersByOpenid =
        openids.length > 0 && typeof this.store.getUsersByOpenids === "function"
          ? await this.store.getUsersByOpenids(openids)
          : {};

      for (const rawTask of dueTasks) {
        const task = this.#normalizeTaskSettings(rawTask);
        const user = this.#normalizeUserSettings(task.openid, usersByOpenid[task.openid]);
        if (this.#isTaskSilenced(task, user, now)) {
          await this.#markTaskSilencedUntil(task, user, now);
          continue;
        }
        await this.checkTask(task.id);
      }
    } finally {
      this.isChecking = false;
    }
  }

  async listTasks(openid) {
    let tasks;

    if (typeof this.store.listTasks === "function") {
      tasks = await this.store.listTasks(openid || undefined);
      const missingLatestChangeIds = tasks
        .filter((task) => !task.latestChange)
        .map((task) => task.id);
      const historiesByTaskId =
        missingLatestChangeIds.length > 0 &&
        typeof this.store.getHistoriesByTaskIds === "function"
          ? await this.store.getHistoriesByTaskIds(missingLatestChangeIds)
          : {};

      tasks = tasks.map((task) => ({
        ...this.#normalizeTaskSettings(task),
        ...(task.latestChange
          ? {
              lastPriceChangeAt: task.lastPriceChangeAt || null,
              latestChange: task.latestChange
            }
          : this.#buildLatestChangePayload(
              task,
              historiesByTaskId[task.id] || []
            ))
      }));
    } else {
      const db = await this.store.read();
      tasks = db.tasks
        .sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .map((task) => {
          const histories = db.histories[task.id] || [];
          return {
            ...this.#normalizeTaskSettings(task),
            ...this.#buildLatestChangePayload(task, histories)
          };
        });

      if (openid) {
        tasks = tasks.filter(t => t.openid === openid);
      }
    }

    return tasks;
  }

  async getTask(id) {
    if (typeof this.store.getTask === "function") {
      const task = await this.store.getTask(id);
      return task ? this.#normalizeTaskSettings(task) : null;
    }

    const db = await this.store.read();
    const task = db.tasks.find((item) => item.id === id) || null;
    return task ? this.#normalizeTaskSettings(task) : null;
  }

  async getHistory(id) {
    if (typeof this.store.getHistory === "function") {
      return this.store.getHistory(id);
    }

    const db = await this.store.read();
    const items = db.histories[id] || [];
    return [...items].reverse();
  }

  async getEvents({ taskId, limit = 50 } = {}) {
    if (
      typeof this.store.getEvents === "function" &&
      typeof this.store.listTasks === "function"
    ) {
      const [events, tasks] = await Promise.all([
        this.store.getEvents({ taskId, limit }),
        this.store.listTasks()
      ]);
      const taskMap = {};
      for (const task of tasks) {
        taskMap[task.id] = task.name;
      }
      return events.map((e) => ({
        ...e,
        taskName: taskMap[e.taskId] || e.taskId
      }));
    }

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
    const task = await this.getTask(id);
    if (!task) return null;

    const updated = { ...task, unreadEvents: 0, updatedAt: isoNow() };
    if (typeof this.store.writeTask === "function") {
      await this.store.writeTask(updated);
    } else {
      await this.store.update((nextDb) => ({
        ...nextDb,
        tasks: nextDb.tasks.map((item) => (item.id === id ? updated : item))
      }));
    }
    return updated;
  }

  /**
   * 增加订阅消息配额
   * 用户每次授权订阅消息时调用
   */
  async addSubscribeQuota(id, amount = 1) {
    const task = await this.getTask(id);
    if (!task) return null;

    const updated = {
      ...task,
      subscribeQuota: (task.subscribeQuota || 0) + amount,
      updatedAt: isoNow()
    };

    if (typeof this.store.writeTask === "function") {
      await this.store.writeTask(updated);
    } else {
      await this.store.update((nextDb) => ({
        ...nextDb,
        tasks: nextDb.tasks.map((item) => (item.id === id ? updated : item))
      }));
    }

    return updated;
  }

  async getUserSettings(openid) {
    const normalizedOpenid = String(openid || "").trim();
    if (!normalizedOpenid) {
      throw new Error("openid 不能为空");
    }

    const user =
      typeof this.store.getUserByOpenid === "function"
        ? await this.store.getUserByOpenid(normalizedOpenid)
        : ((await this.store.read()).users || []).find((item) => item.openid === normalizedOpenid) || null;

    return this.#normalizeUserSettings(normalizedOpenid, user);
  }

  /**
   * 确保用户在数据库中有记录，若不存在则创建默认记录。
   * 登录时调用，保证任何用户首次登录即写入 users 表。
   */
  async ensureUser(openid) {
    const normalizedOpenid = String(openid || "").trim();
    if (!normalizedOpenid) return;

    const existing =
      typeof this.store.getUserByOpenid === "function"
        ? await this.store.getUserByOpenid(normalizedOpenid)
        : ((await this.store.read()).users || []).find((item) => item.openid === normalizedOpenid) || null;

    if (existing) return; // 已存在，无需创建

    const newUser = this.#normalizeUserSettings(normalizedOpenid, null);
    if (typeof this.store.writeUser === "function") {
      await this.store.writeUser(newUser);
    } else {
      await this.store.update((db) => ({
        ...db,
        users: [newUser, ...(db.users || [])]
      }));
    }
  }

  async updateUserSettings(input) {
    const openid = String(input.openid || "").trim();
    if (!openid) {
      throw new Error("openid 不能为空");
    }

    const current = await this.getUserSettings(openid);
    const next = this.#buildUserSettingsPayload(current, input);

    if (typeof this.store.writeUser === "function") {
      await this.store.writeUser(next);
    } else {
      await this.store.update((db) => ({
        ...db,
        users: [
          next,
          ...((db.users || []).filter((item) => item.openid !== openid))
        ]
      }));
    }

    await this.#rescheduleTasksForUserSettingsChange(current, next);

    return next;
  }

  async stopAllTasks() {
    const tasks = typeof this.store.listTasks === "function"
      ? await this.store.listTasks()
      : (await this.store.read()).tasks;
    const now = isoNow();
    
    const updatedTasks = tasks.map((task) => ({
      ...task,
      active: false,
      updatedAt: now
    }));

    if (typeof this.store.writeTask === "function") {
      for (const task of updatedTasks) {
        await this.store.writeTask(task);
      }
    } else {
      await this.store.update((nextDb) => ({
        ...nextDb,
        tasks: updatedTasks
      }));
    }

    return { stoppedCount: tasks.length };
  }

  /**
   * 消费订阅消息配额
   * 发送订阅消息成功后调用
   * @returns {boolean} 是否消费成功
   */
  async consumeSubscribeQuota(id) {
    const task = await this.getTask(id);
    if (!task || !task.subscribeQuota || task.subscribeQuota <= 0) {
      return false;
    }

    const updated = {
      ...task,
      subscribeQuota: task.subscribeQuota - 1,
      updatedAt: isoNow()
    };

    if (typeof this.store.writeTask === "function") {
      await this.store.writeTask(updated);
    } else {
      await this.store.update((nextDb) => ({
        ...nextDb,
        tasks: nextDb.tasks.map((item) => (item.id === id ? updated : item))
      }));
    }

    return true;
  }

  async deleteTask(id) {
    if (typeof this.store.deleteTaskData === "function") {
      const task = await this.getTask(id);
      if (!task) return null;
      await this.store.deleteTaskData(id);
      return task;
    }

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
    const monitorType = this.#resolveMonitorType(input);
    const threshold = Number(
      input.threshold == null
        ? (monitorType === "exchange_rate" ? EXCHANGE_DEFAULT_THRESHOLD
            : monitorType === "gold" ? GOLD_DEFAULT_THRESHOLD
            : DEFAULT_THRESHOLD)
        : input.threshold
    );
    const checkIntervalSec = Number(
      input.checkIntervalSec == null
        ? (monitorType === "exchange_rate" ? EXCHANGE_DEFAULT_CHECK_INTERVAL_SEC
            : monitorType === "gold" ? GOLD_DEFAULT_CHECK_INTERVAL_SEC
            : DEFAULT_CHECK_INTERVAL_SEC)
        : input.checkIntervalSec
    );
    const targetPrice = input.targetPrice == null ? null : Number(input.targetPrice);
    const notifyOnDrop = input.notifyOnDrop == null ? true : Boolean(input.notifyOnDrop);

    if (!["flight", "exchange_rate", "gold"].includes(monitorType)) {
      throw new Error("monitorType 仅支持 flight、exchange_rate 或 gold");
    }

    if (!partial || input.name != null) {
      if (!String(input.name || "").trim()) {
        throw new Error("任务名称不能为空");
      }
    }

    if (!partial || input.openid != null) {
      if (!String(input.openid || "").trim()) {
        throw new Error("openid 不能为空");
      }
    }

    if (monitorType === "exchange_rate") {
      // 汇率监控校验
      if (!partial || input.baseCurrency != null) {
        const base = String(input.baseCurrency || "").trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(base)) {
          throw new Error("基础货币代码必须是 3 位字母（如 USD）");
        }
      }
      if (!partial || input.quoteCurrency != null) {
        const quote = String(input.quoteCurrency || "").trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(quote)) {
          throw new Error("报价货币代码必须是 3 位字母（如 CNY）");
        }
      }
      if (!partial || (input.baseCurrency != null && input.quoteCurrency != null)) {
        const base = String(input.baseCurrency || "").trim().toUpperCase();
        const quote = String(input.quoteCurrency || "").trim().toUpperCase();
        if (base === quote) {
          throw new Error("基础货币和报价货币不能相同");
        }
      }
    } else if (monitorType === "gold") {
      // 金价监控无需额外字段校验
    } else {
      // 机票监控校验
      const flightWay = input.flightWay || "Oneway";
      const departDates = normalizeDateList(input.departDates);
      const returnDates = normalizeDateList(input.returnDates);

      if (!partial || input.placeFrom != null) {
        if (!/^[A-Za-z]{3}$/.test(String(input.placeFrom || "").trim())) {
          throw new Error("出发城市代码必须是 3 位字母代码");
        }
      }

      if (!partial || input.placeTo != null) {
        if (!/^[A-Za-z]{3}$/.test(String(input.placeTo || "").trim())) {
          throw new Error("到达城市代码必须是 3 位字母代码");
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

    const result = {
      name: String(input.name || "").trim(),
      monitorType,
      threshold,
      checkIntervalSec,
      targetPrice,
      notifyOnDrop,
      pushplusToken: String(input.pushplusToken || "").trim(),
      pushplusEnabled:
        input.pushplusEnabled == null
          ? Boolean(String(input.pushplusToken || "").trim())
          : Boolean(input.pushplusEnabled),
      openid: String(input.openid || "").trim(),
      subscribeEnabled: input.subscribeEnabled == null ? false : Boolean(input.subscribeEnabled),
      silentHoursEnabled:
        input.silentHoursEnabled == null ? true : Boolean(input.silentHoursEnabled),
      active: input.active == null ? true : Boolean(input.active)
    };

    if (monitorType === "exchange_rate") {
      result.baseCurrency = String(input.baseCurrency || "").trim().toUpperCase();
      result.quoteCurrency = String(input.quoteCurrency || "").trim().toUpperCase();
    } else if (monitorType === "gold") {
      result.goldVarietyKey = String(input.goldVarietyKey || "4").trim();
    } else {
      result.placeFrom = String(input.placeFrom || "").trim().toUpperCase();
      result.placeTo = String(input.placeTo || "").trim().toUpperCase();
      result.flightWay = input.flightWay || "Oneway";
      result.departDates = normalizeDateList(input.departDates);
      result.returnDates = normalizeDateList(input.returnDates);
    }

    return result;
  }

  #resolveMonitorType(input = {}) {
    if (input.monitorType === "flight" || input.monitorType === "exchange_rate" || input.monitorType === "gold") {
      return input.monitorType;
    }

    const baseCurrency = String(input.baseCurrency || "").trim();
    const quoteCurrency = String(input.quoteCurrency || "").trim();
    const placeFrom = String(input.placeFrom || "").trim();
    const placeTo = String(input.placeTo || "").trim();

    if ((baseCurrency || quoteCurrency) && !placeFrom && !placeTo) {
      return "exchange_rate";
    }

    return "flight";
  }

  async createTask(input) {
    const payload = this.validateTaskInput(input);
    const now = isoNow();
    const initialSubscribeQuota = Math.max(0, Number(input.subscribeQuota || 0));
    const pushplusToken = await this.#resolveTaskPushplusToken(payload);

    const task = {
      id: createId("task"),
      ...payload,
      pushplusToken,
      baseline: {},
      latestSnapshot: null,
      latestSummary: null,
      latestChange: null,
      lastError: null,
      lastCheckedAt: null,
      lastPriceChangeAt: null,
      seenPriceKeys: [],
      nextCheckAt: now,
      unreadEvents: 0,
      subscribeQuota: initialSubscribeQuota,
      createdAt: now,
      updatedAt: now
    };

    // 汇率任务没有日期字段，跳过日期相关清零
    if (payload.monitorType === "exchange_rate") {
      // 无额外初始化
    }

    if (typeof this.store.writeTask === "function") {
      await this.store.writeTask(task);
    } else {
      await this.store.update((db) => ({
        ...db,
        tasks: [task, ...db.tasks],
        histories: {
          ...db.histories,
          [task.id]: []
        }
      }));
    }

    // 首次检查价格并发送创建通知
    const hasPushPlus = !!task.pushplusEnabled && !!task.pushplusToken;
    const hasSubscribe = !!task.openid && task.subscribeEnabled;
    if (hasPushPlus || hasSubscribe) {
      this.#withTaskCheckLock(task.id, () => this.#initialCheckAndNotify(task)).catch((err) => {
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
      const normalizedTask = this.#normalizeTaskSettings(task);
      const user = await this.getUserSettings(normalizedTask.openid);
      if (this.#isTaskSilenced(normalizedTask, user, Date.now())) {
        const updated = await this.#markTaskSilencedUntil(normalizedTask, user, Date.now());
        return { task: updated, notifyResults: [], skipped: "silent" };
      }

      const snapshot = await this.provider.fetchPrices(normalizedTask);
      const summary = buildSummaryFromSnapshot(snapshot);
      const checkedAt = isoNow();
      const nextCheckAt = new Date(
        Date.now() + task.checkIntervalSec * 1000
      ).toISOString();

      const updatedTask = {
        ...normalizedTask,
        baseline: this.#buildBaseline(snapshot),
        latestSnapshot: snapshot,
        latestSummary: summary,
        latestChange: normalizedTask.latestChange || null,
        lastError: null,
        lastCheckedAt: checkedAt,
        lastPriceChangeAt: normalizedTask.lastPriceChangeAt || null,
        seenPriceKeys: this.#mergeSeenPriceKeys(normalizedTask, [], snapshot),
        nextCheckAt,
        updatedAt: checkedAt
      };

      // 发送创建任务通知
      const notifyResults = [];

      let title, content;
      if (normalizedTask.monitorType === "exchange_rate") {
        const pair = `${normalizedTask.baseCurrency}/${normalizedTask.quoteCurrency}`;
        const rate = summary?.minPrice != null ? summary.minPrice.toFixed(4) : "暂无";
        title = `🔔 ${pair} 汇率监控已启动`;
        content = `监控货币对：${pair}\n当前汇率：${rate}\n变动阈值：${normalizedTask.threshold}\n检查间隔：${normalizedTask.checkIntervalSec}秒`;
      } else if (normalizedTask.monitorType === "gold") {
        const variety = normalizedTask.latestSnapshot?.variety || "黄金";
        const price = summary?.minPrice != null ? summary.minPrice.toFixed(2) : "暂无";
        title = `🔔 ${variety} 金价监控已启动`;
        content = `品种：${variety}\n当前价格：${price} 元/克\n变动阈值：${normalizedTask.threshold} 元/克\n检查间隔：${normalizedTask.checkIntervalSec}秒`;
      } else {
        const fromCity = getCityByCode(normalizedTask.placeFrom);
        const toCity = getCityByCode(normalizedTask.placeTo);
        const dateText = normalizedTask.departDates.map((d) => `${d.slice(4, 6)}月${d.slice(6, 8)}日`).join("、");
        title = `${fromCity}飞${toCity}票价监控已创建`;
        content = `${dateText}${fromCity}飞${toCity} 当前最低价${summary?.minPrice || "暂无"}元`;
      }

      // PushPlus 通知
      const pushplusToken = await this.#resolveTaskPushplusToken(normalizedTask);
      if (pushplusToken) {
        const ppResult = await this.notifier.send({
          token: pushplusToken,
          title,
          content
        });
        notifyResults.push({ channel: "pushplus", result: ppResult });
      }

      // 微信订阅消息是一次性额度。创建任务时不消耗它，保留给真正的变价通知。

      // 记录初始检查历史（金价每次检查都记历史，其他类型在 checkTask 中处理）
      if (snapshot.monitorType === "gold") {
        const checkedAt = isoNow();
        const historyRecord = {
          id: createId("history"),
          taskId: task.id,
          checkedAt,
          summary,
          changes: [{ type: "initial", key: "gold_price", label: snapshot.variety || "黄金", previous: null, current: snapshot.price, delta: null }],
          snapshot
        };

        if (typeof this.store.appendHistory === "function") {
          await this.store.appendHistory(task.id, historyRecord, { limit: HISTORY_RETENTION_LIMIT });
        } else {
          await this.store.update((nextDb) => ({
            ...nextDb,
            histories: {
              ...nextDb.histories,
              [task.id]: [historyRecord, ...(nextDb.histories[task.id] || [])].slice(0, HISTORY_RETENTION_LIMIT)
            }
          }));
        }
      }

      if (typeof this.store.writeTask === "function") {
        await this.store.writeTask(updatedTask);
      } else {
        await this.store.update((nextDb) => ({
          ...nextDb,
          tasks: nextDb.tasks.map((item) =>
            item.id === task.id ? updatedTask : item
          )
        }));
      }

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

      if (typeof this.store.writeTask === "function") {
        await this.store.writeTask(failedTask);
      } else {
        await this.store.update((nextDb) => ({
          ...nextDb,
          tasks: nextDb.tasks.map((item) =>
            item.id === task.id ? failedTask : item
          )
        }));
      }

      throw error;
    }
  }

  async updateTask(id, patch) {
    const current = await this.getTask(id);

    if (!current) {
      return null;
    }

    const mergedInput = {
      ...current,
      ...patch
    };
    const payload = this.validateTaskInput(mergedInput, { partial: true });
    const pushplusToken = await this.#resolveTaskPushplusToken({
      ...current,
      ...payload
    });
    const updated = {
      ...current,
      ...payload,
      pushplusToken,
      baseline: current.baseline || {},
      updatedAt: isoNow()
    };

    // 允许直接设置 subscribeQuota (validateTaskInput 不处理此字段)
    if (patch.subscribeQuota !== undefined) {
      updated.subscribeQuota = Math.max(0, Number(patch.subscribeQuota));
    }

    // 关键字段变更时重置价格相关状态，触发重新检查
    const flightNeedsReset = (
      patch.placeFrom !== undefined && patch.placeFrom !== current.placeFrom ||
      patch.placeTo !== undefined && patch.placeTo !== current.placeTo ||
      patch.flightWay !== undefined && patch.flightWay !== current.flightWay ||
      patch.departDates !== undefined && JSON.stringify(normalizeDateList(patch.departDates)) !== JSON.stringify(current.departDates) ||
      patch.returnDates !== undefined && JSON.stringify(normalizeDateList(patch.returnDates)) !== JSON.stringify(current.returnDates || [])
    );
    const fxNeedsReset = (
      patch.baseCurrency !== undefined && patch.baseCurrency !== current.baseCurrency ||
      patch.quoteCurrency !== undefined && patch.quoteCurrency !== current.quoteCurrency
    );
    const needsReset = flightNeedsReset || fxNeedsReset;

    if (needsReset) {
      updated.baseline = {};
      updated.latestSnapshot = null;
      updated.latestSummary = null;
      updated.latestChange = null;
      updated.lastPriceChangeAt = null;
      updated.lastError = null;
      updated.seenPriceKeys = [];
      updated.nextCheckAt = isoNow();
    } else {
      // 即使关键字段未变，也清除错误状态
      if (current.lastError) {
        updated.lastError = null;
      }
      // 从暂停恢复活跃时重置 nextCheckAt
      if (patch.active === true && !current.active) {
        updated.nextCheckAt = isoNow();
      }
    }

    if (updated.active && updated.openid) {
      const nowMs = Date.now();
      const user = await this.getUserSettings(updated.openid);
      if (
        updated.silentHoursEnabled !== false &&
        this.#isTaskSilenced(updated, user, nowMs)
      ) {
        updated.nextCheckAt = this.#getSilentResumeIso(user, nowMs);
      } else if (
        !needsReset &&
        patch.silentHoursEnabled !== undefined &&
        Boolean(patch.silentHoursEnabled) !== Boolean(current.silentHoursEnabled)
      ) {
        updated.nextCheckAt = isoNow();
      }
    }

    if (typeof this.store.writeTask === "function") {
      await this.store.writeTask(updated);
    } else {
      await this.store.update((nextDb) => ({
        ...nextDb,
        tasks: nextDb.tasks.map((item) => (item.id === id ? updated : item))
      }));
    }

    return updated;
  }

  /**
   * 判断任务是否已过期（所有出发日期都已过去）
   * 汇率监控任务永不过期
   */
  #isTaskExpired(task) {
    if (!task) return false;
    // 汇率监控和金价监控永不过期
    if (task.monitorType === "exchange_rate") return false;
    if (task.monitorType === "gold") return false;
    if (!task.departDates || !task.departDates.length) {
      return false;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    // 如果最大出发日期 < 今天，则已过期
    const maxDepartDate = Math.max(...task.departDates.map(d => Number(d)));
    return maxDepartDate < Number(todayStr);
  }

  async checkTask(id) {
    return this.#withTaskCheckLock(id, async () => {
    let task;
    let histories;
    if (
      typeof this.store.getTask === "function" &&
      typeof this.store.getHistory === "function"
    ) {
      [task, histories] = await Promise.all([
        this.store.getTask(id),
        this.store.getHistory(id)
      ]);
    } else {
      const db = await this.store.read();
      task = db.tasks.find((item) => item.id === id);
      histories = db.histories[id] || [];
    }

    if (!task) {
      throw new Error("task_not_found");
    }

    const normalizedTask = this.#normalizeTaskSettings(task);
    const user = await this.getUserSettings(normalizedTask.openid);

    if (this.#isTaskSilenced(normalizedTask, user, Date.now())) {
      const updated = await this.#markTaskSilencedUntil(normalizedTask, user, Date.now());
      return { task: updated, changes: [], skipped: "silent" };
    }

    // 自动过期检查：如果任务已过期，自动暂停并不再检查价格
    if (normalizedTask.active && this.#isTaskExpired(normalizedTask)) {
      const updated = { ...normalizedTask, active: false, updatedAt: isoNow() };
      if (typeof this.store.writeTask === "function") {
        await this.store.writeTask(updated);
      } else {
        await this.store.update((nextDb) => ({
          ...nextDb,
          tasks: nextDb.tasks.map((item) => (item.id === id ? updated : item))
        }));
      }
      return { task: updated, changes: [], skipped: 'expired' };
    }

    try {
      const snapshot = await this.provider.fetchPrices(normalizedTask);
      const changes = this.#compareSnapshot(normalizedTask, snapshot, histories || []);
      const checkedAt = isoNow();
      const summary = buildSummaryFromSnapshot(snapshot);
      const nextCheckAt = new Date(
        Date.now() + task.checkIntervalSec * 1000
      ).toISOString();
      const seenPriceKeys = this.#mergeSeenPriceKeys(task, histories || [], snapshot);
      const previousMinPrice = normalizedTask.latestSummary?.minPrice;
      const existingLatestChangePayload = this.#buildLatestChangePayload(
        normalizedTask,
        histories || []
      );
      let latestChange = existingLatestChangePayload.latestChange;
      let lastPriceChangeAt = existingLatestChangePayload.lastPriceChangeAt;
      if (
        previousMinPrice != null &&
        summary?.minPrice != null &&
        previousMinPrice !== summary.minPrice
      ) {
        const delta = summary.minPrice - previousMinPrice;
        latestChange = {
          checkedAt,
          type: delta < 0 ? "drop" : "rise",
          delta: Math.abs(delta),
          currentPrice: summary.minPrice,
          previousPrice: previousMinPrice
        };
        lastPriceChangeAt = checkedAt;
      }

      const updatedTask = {
        ...normalizedTask,
        baseline: this.#buildBaseline(snapshot),
        latestSnapshot: snapshot,
        latestSummary: summary,
        latestChange,
        lastError: null,
        lastCheckedAt: checkedAt,
        lastPriceChangeAt,
        seenPriceKeys,
        nextCheckAt,
        updatedAt: checkedAt
      };

      // 仅当有变化时记录历史；但金价任务每次检查都记历史（用于展示走势图）
      const shouldLogHistory = changes.length > 0 || snapshot.monitorType === "gold";

      // Filter changes for notification based on strategy
      const notifyChanges = changes.filter((change) => {
        if (change.type === "initial") return false;
        if (change.meetsThreshold === false) return false;

        // 目标价格触发：价格下降到目标价以下（无论是否开启仅降价通知）
        if (normalizedTask.targetPrice && change.type === "drop" && change.current <= normalizedTask.targetPrice) {
          return true;
        }

        // notifyOnDrop: only notify on price drops
        if (normalizedTask.notifyOnDrop && change.type === "rise") return false;

        return true;
      });

      const notifyResults = [];
      // PushPlus 通知
      const pushplusToken = await this.#resolveTaskPushplusToken(normalizedTask);
      if (notifyChanges.length > 0 && pushplusToken) {
        const firstChange = notifyChanges[0];
        const isDrop = firstChange.type === "drop";
        let title, content;
        if (normalizedTask.monitorType === "exchange_rate") {
          const pair = `${normalizedTask.baseCurrency}/${normalizedTask.quoteCurrency}`;
          const trend = isDrop ? "下跌" : "上涨";
          const trendEmoji = isDrop ? "📉" : "📈";
          const currentRate = summary?.minPrice != null ? summary.minPrice.toFixed(4) : firstChange.current;
          const delta = firstChange.delta.toFixed(4);
          const deltaAbs = Math.abs(firstChange.delta).toFixed(4);
          title = `${trendEmoji} ${pair} 汇率${trend} ${deltaAbs}`;
          content = `${pair} 当前汇率 ${currentRate}\n较上次${isDrop ? "下跌" : "上涨"} ${deltaAbs}\n变动幅度 ${((deltaAbs / currentRate) * 100).toFixed(2)}%`;
        } else if (normalizedTask.monitorType === "gold") {
          const variety = normalizedTask.latestSnapshot?.variety || "黄金";
          const trend = isDrop ? "下跌" : "上涨";
          const trendEmoji = isDrop ? "📉" : "📈";
          const currentPrice = summary?.minPrice != null ? summary.minPrice.toFixed(2) : firstChange.current;
          const deltaAbs = Math.abs(firstChange.delta).toFixed(2);
          const limit = normalizedTask.latestSnapshot?.limit || "0%";
          title = `${trendEmoji} ${variety} 金价${trend} ${deltaAbs} 元/克`;
          content = `${variety} 当前价格 ${currentPrice} 元/克\n较上次${isDrop ? "下跌" : "上涨"} ${deltaAbs} 元/克\n今日涨跌幅 ${limit}`;
        } else {
          const fromCity = getCityByCode(normalizedTask.placeFrom);
          const toCity = getCityByCode(normalizedTask.placeTo);
          const dateText = normalizedTask.departDates.map((d) => `${d.slice(4, 6)}月${d.slice(6, 8)}日`).join("、");
          const delta = firstChange.delta;
          const deltaAbs = Math.abs(delta);
          title = `${fromCity}到${toCity}机票（${dateText}）${isDrop ? "降价" : "涨价"} ${deltaAbs} 元`;
          content = `${dateText} ${fromCity}飞${toCity}当前最低价${summary?.minPrice || firstChange.current}元，比上次${isDrop ? "跌" : "涨"}了${deltaAbs}元`;
        }
        const result = await this.notifier.send({
          token: pushplusToken,
          title,
          content
        });
        notifyResults.push({ channel: "pushplus", result });
      }

      // 微信订阅消息通知（检查配额）；gold 类型暂不支持订阅消息
      if (notifyChanges.length > 0 && normalizedTask.openid && normalizedTask.subscribeEnabled && normalizedTask.subscribeQuota > 0 && this.wxSubscribeNotifier && normalizedTask.monitorType !== "gold") {
        const { WxSubscribeNotifier } = require("./wx-subscribe-notifier");
        let subscribeData;
        if (normalizedTask.monitorType === "exchange_rate") {
          const firstChange = notifyChanges[0];
          const changeType = firstChange.type;
          const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
          const timeStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")} ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
          const code = `${normalizedTask.baseCurrency}-${normalizedTask.quoteCurrency}`;
          const rate = firstChange.current != null ? String(firstChange.current) : "0";
          const rawDelta = firstChange.delta != null ? firstChange.delta : 0;
          const diff = changeType === "drop" ? `-${Math.abs(rawDelta).toFixed(4)}` : `${Math.abs(rawDelta).toFixed(4)}`;
          subscribeData = {
            character_string1: { value: code },
            amount4: { value: rate },
            time11: { value: timeStr },
            amount14: { value: diff }
          };
        } else {
          const fromCity = getCityByCode(normalizedTask.placeFrom);
          const toCity = getCityByCode(normalizedTask.placeTo);
          subscribeData = WxSubscribeNotifier.buildPriceChangeData(normalizedTask, notifyChanges, fromCity, toCity);
        }
        const wxResult = await this.wxSubscribeNotifier.send({
          openid: normalizedTask.openid,
          data: subscribeData,
          page: `pages/task-detail/task-detail?id=${normalizedTask.id}`
        });
        // 发送成功后在当前 task 快照上直接核销，避免后续 writeTask 用旧值覆盖。
        if (wxResult && wxResult.errcode === 0) {
          updatedTask.subscribeQuota = Math.max(0, Number(updatedTask.subscribeQuota || 0) - 1);
        } else if (wxResult && wxResult.errcode === 43101) {
          // 用户已取消订阅或授权过期 — 清零僵尸配额，避免重复尝试
          updatedTask.subscribeQuota = 0;
          console.warn(`User ${normalizedTask.openid} subscription expired for task ${id}, quota reset to 0`);
        }
        notifyResults.push({
          channel: "wxsubscribe",
          result: wxResult,
          quotaConsumed: wxResult?.errcode === 0,
          subscribeQuota: updatedTask.subscribeQuota || 0
        });
      }

      // Update unreadEvents count
      const unreadDelta = notifyChanges.length > 0 ? 1 : 0;
      updatedTask.unreadEvents = (normalizedTask.unreadEvents || 0) + unreadDelta;

      const historyRecord = shouldLogHistory
        ? {
            id: createId("history"),
            taskId: id,
            checkedAt,
            summary,
            changes,
            snapshot
          }
        : null;

      const eventRecord = shouldLogHistory
        ? {
            id: createId("event"),
            taskId: id,
            createdAt: checkedAt,
            changes,
            notifyResults,
            notified: notifyChanges.length > 0
          }
        : null;
      const isDuplicateHistory = historyRecord
        ? this.#isDuplicateHistoryRecord(historyRecord, histories || [])
        : false;

      if (
        typeof this.store.writeTask === "function" &&
        typeof this.store.appendHistory === "function" &&
        typeof this.store.appendEvent === "function"
      ) {
        await this.store.writeTask(updatedTask);
        if (historyRecord && !isDuplicateHistory) {
          await this.store.appendHistory(id, historyRecord, {
            limit: HISTORY_RETENTION_LIMIT
          });
        }
        if (eventRecord && !isDuplicateHistory) {
          await this.store.appendEvent(eventRecord, { limit: 200 });
        }
      } else {
        await this.store.update((nextDb) => {
          const newHistories = shouldLogHistory && !isDuplicateHistory
            ? {
                ...nextDb.histories,
                [id]: [historyRecord, ...(nextDb.histories[id] || [])].slice(
                  0,
                  HISTORY_RETENTION_LIMIT
                )
              }
            : nextDb.histories;

          const newEvents = shouldLogHistory && !isDuplicateHistory
            ? [eventRecord, ...nextDb.events].slice(0, 200)
            : nextDb.events;

          return {
            ...nextDb,
            tasks: nextDb.tasks.map((item) => (item.id === id ? updatedTask : item)),
            histories: newHistories,
            events: newEvents
          };
        });
      }

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

      if (typeof this.store.writeTask === "function") {
        await this.store.writeTask(failedTask);
      } else {
        await this.store.update((nextDb) => ({
          ...nextDb,
          tasks: nextDb.tasks.map((item) =>
            item.id === id ? failedTask : item
          )
        }));
      }

      throw error;
    }
    });
  }

  #buildBaseline(snapshot) {
    // 汇率任务：金价任务都用固定 key，不依赖日期
    if (snapshot.monitorType === "exchange_rate" || snapshot.monitorType === "gold") {
      const key = snapshot.monitorType === "gold"
        ? "gold_price"
        : `${snapshot.base}_${snapshot.quote}`;
      return { [key]: snapshot.monitorType === "gold" ? snapshot.price : snapshot.rate };
    }

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
    const seenKeys = this.#buildSeenPriceKeySet(task, histories);
    
    const changes = [];

    // 汇率任务：金价任务都用固定 key 比较，避免日期变化导致永远是 initial
    if (snapshot.monitorType === "exchange_rate" || snapshot.monitorType === "gold") {
      const key = snapshot.monitorType === "gold"
        ? "gold_price"
        : `${snapshot.base}_${snapshot.quote}`;
      const current = snapshot.monitorType === "gold" ? snapshot.price : snapshot.rate;
      let previous = baseline[key];

      // 兼容旧数据：baseline 里可能存的是日期 key，尝试取其中任一值作为 previous
      if (previous == null) {
        const oldValues = Object.values(baseline).filter(v => typeof v === "number");
        if (oldValues.length > 0) {
          previous = oldValues[oldValues.length - 1];
        }
      }

      if (previous == null && !seenKeys.has(key)) {
        changes.push({
          type: "initial",
          key,
          label: snapshot.monitorType === "gold" ? (snapshot.variety || "黄金") : `${snapshot.base}/${snapshot.quote}`,
          previous: null,
          current,
          delta: null
        });
        return changes;
      }

      if (previous != null) {
        const delta = current - previous;
        if (delta !== 0) {
          changes.push({
            type: delta > 0 ? "rise" : "drop",
            key,
            label: snapshot.monitorType === "gold" ? (snapshot.variety || "黄金") : `${snapshot.base}/${snapshot.quote}`,
            previous,
            current,
            delta,
            meetsThreshold: Math.abs(delta) >= task.threshold
          });
        }
      }

      return changes;
    }

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

  #buildSeenPriceKeySet(task, histories = []) {
    const seenKeys = new Set(task.seenPriceKeys || []);
    for (const history of histories) {
      for (const change of history.changes || []) {
        if (change.key) {
          seenKeys.add(change.key);
        }
      }
    }
    return seenKeys;
  }

  #extractSnapshotKeys(snapshot) {
    const keys = [];

    // 汇率任务：金价任务都用固定 key
    if (snapshot.monitorType === "exchange_rate" || snapshot.monitorType === "gold") {
      keys.push(snapshot.monitorType === "gold" ? "gold_price" : `${snapshot.base}_${snapshot.quote}`);
      return keys;
    }

    if (snapshot.flightWay === "Roundtrip") {
      for (const [departDate, returnMap] of Object.entries(snapshot.prices || {})) {
        for (const returnDate of Object.keys(returnMap || {})) {
          keys.push(`${departDate}_${returnDate}`);
        }
      }
      return keys;
    }

    for (const date of Object.keys(snapshot.prices || {})) {
      keys.push(date);
    }
    return keys;
  }

  #mergeSeenPriceKeys(task, histories = [], snapshot = null) {
    const seenKeys = this.#buildSeenPriceKeySet(task, histories);
    if (snapshot) {
      for (const key of this.#extractSnapshotKeys(snapshot)) {
        seenKeys.add(key);
      }
    }
    return [...seenKeys];
  }

  #buildLatestChangePayload(task, histories = []) {
    if (task.latestChange) {
      return {
        lastPriceChangeAt: task.lastPriceChangeAt || task.latestChange.checkedAt || null,
        latestChange: task.latestChange
      };
    }

    const lastHistory = histories[0];
    let latestChange = null;
    for (let i = 0; i < histories.length - 1; i++) {
      const current = histories[i];
      const previous = histories[i + 1];
      const currentPrice = current.summary?.minPrice;
      const previousPrice = previous.summary?.minPrice;
      if (
        currentPrice != null &&
        previousPrice != null &&
        currentPrice !== previousPrice
      ) {
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
      lastPriceChangeAt: latestChange?.checkedAt || lastHistory?.checkedAt || null,
      latestChange
    };
  }

  #normalizeTaskSettings(task) {
    if (!task) {
      return task;
    }

    return {
      ...task,
      pushplusEnabled:
        task.pushplusEnabled == null
          ? Boolean(String(task.pushplusToken || "").trim())
          : Boolean(task.pushplusEnabled),
      silentHoursEnabled:
        task.silentHoursEnabled == null ? true : Boolean(task.silentHoursEnabled)
    };
  }

  #normalizeUserSettings(openid, user = null) {
    const normalizedOpenid = String(openid || "").trim();
    const source = user || {};
    return {
      id: source.id || `user_${normalizedOpenid}`,
      openid: normalizedOpenid,
      pushplusToken: String(source.pushplusToken || "").trim(),
      silentStart: this.#normalizeTimeValue(source.silentStart, DEFAULT_SILENT_START),
      silentEnd: this.#normalizeTimeValue(source.silentEnd, DEFAULT_SILENT_END),
      createdAt: source.createdAt || isoNow(),
      updatedAt: source.updatedAt || source.createdAt || isoNow()
    };
  }

  #buildUserSettingsPayload(current, patch) {
    return {
      ...current,
      pushplusToken:
        patch.pushplusToken == null
          ? current.pushplusToken
          : String(patch.pushplusToken || "").trim(),
      silentStart: this.#normalizeTimeValue(
        patch.silentStart == null ? current.silentStart : patch.silentStart,
        DEFAULT_SILENT_START
      ),
      silentEnd: this.#normalizeTimeValue(
        patch.silentEnd == null ? current.silentEnd : patch.silentEnd,
        DEFAULT_SILENT_END
      ),
      updatedAt: isoNow()
    };
  }

  #normalizeTimeValue(value, fallback) {
    const raw = String(value || "").trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return fallback;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return fallback;
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  #resolveTimeMinutes(value) {
    const [hour, minute] = this.#normalizeTimeValue(value, DEFAULT_SILENT_START).split(":").map(Number);
    return hour * 60 + minute;
  }

  #getChinaNowParts(nowMs = Date.now()) {
    const local = new Date(nowMs + CHINA_TZ_OFFSET_MS);
    return {
      year: local.getUTCFullYear(),
      month: local.getUTCMonth(),
      date: local.getUTCDate(),
      minutes: local.getUTCHours() * 60 + local.getUTCMinutes()
    };
  }

  #isTaskSilenced(task, user, nowMs = Date.now()) {
    if (!task?.active || task.silentHoursEnabled === false) {
      return false;
    }

    const startMinutes = this.#resolveTimeMinutes(user?.silentStart || DEFAULT_SILENT_START);
    const endMinutes = this.#resolveTimeMinutes(user?.silentEnd || DEFAULT_SILENT_END);
    if (startMinutes === endMinutes) {
      return false;
    }

    const { minutes } = this.#getChinaNowParts(nowMs);
    if (startMinutes < endMinutes) {
      return minutes >= startMinutes && minutes < endMinutes;
    }

    return minutes >= startMinutes || minutes < endMinutes;
  }

  #getSilentResumeIso(user, nowMs = Date.now()) {
    const startMinutes = this.#resolveTimeMinutes(user?.silentStart || DEFAULT_SILENT_START);
    const endMinutes = this.#resolveTimeMinutes(user?.silentEnd || DEFAULT_SILENT_END);
    const parts = this.#getChinaNowParts(nowMs);
    let dayOffset = 0;

    if (startMinutes > endMinutes && parts.minutes >= startMinutes) {
      dayOffset = 1;
    }

    const endHour = Math.floor(endMinutes / 60);
    const endMinute = endMinutes % 60;
    const utcMs =
      Date.UTC(parts.year, parts.month, parts.date + dayOffset, endHour, endMinute) -
      CHINA_TZ_OFFSET_MS;
    return new Date(utcMs).toISOString();
  }

  async #markTaskSilencedUntil(task, user, nowMs = Date.now()) {
    const updated = {
      ...task,
      nextCheckAt: this.#getSilentResumeIso(user, nowMs),
      updatedAt: isoNow()
    };

    if (typeof this.store.writeTask === "function") {
      await this.store.writeTask(updated);
    } else {
      await this.store.update((nextDb) => ({
        ...nextDb,
        tasks: nextDb.tasks.map((item) => (item.id === task.id ? updated : item))
      }));
    }

    return updated;
  }

  async #rescheduleTasksForUserSettingsChange(previousUser, nextUser) {
    const openid = String(nextUser?.openid || "").trim();
    if (!openid) {
      return;
    }

    const tasks =
      typeof this.store.listTasks === "function"
        ? await this.store.listTasks()
        : (await this.store.read()).tasks;
    const relatedTasks = tasks
      .map((task) => this.#normalizeTaskSettings(task))
      .filter(
        (task) =>
          task.openid === openid &&
          task.active &&
          task.silentHoursEnabled !== false
      );

    if (!relatedTasks.length) {
      return;
    }

    const nowMs = Date.now();
    const nowIso = isoNow();
    const updates = relatedTasks
      .map((task) => {
        const wasSilenced = this.#isTaskSilenced(task, previousUser, nowMs);
        const isSilenced = this.#isTaskSilenced(task, nextUser, nowMs);

        if (isSilenced) {
          const nextCheckAt = this.#getSilentResumeIso(nextUser, nowMs);
          if (task.nextCheckAt === nextCheckAt) {
            return null;
          }
          return {
            ...task,
            nextCheckAt,
            updatedAt: nowIso
          };
        }

        if (wasSilenced) {
          return {
            ...task,
            nextCheckAt: nowIso,
            updatedAt: nowIso
          };
        }

        return null;
      })
      .filter(Boolean);

    if (!updates.length) {
      return;
    }

    if (typeof this.store.writeTask === "function") {
      for (const task of updates) {
        await this.store.writeTask(task);
      }
      return;
    }

    const updateMap = Object.fromEntries(updates.map((task) => [task.id, task]));
    await this.store.update((db) => ({
      ...db,
      tasks: db.tasks.map((task) => updateMap[task.id] || task)
    }));
  }

  async #resolveTaskPushplusToken(task) {
    const normalizedTask = this.#normalizeTaskSettings(task);
    if (!normalizedTask.pushplusEnabled) {
      return "";
    }

    const taskToken = String(normalizedTask.pushplusToken || "").trim();
    const user = normalizedTask.openid ? await this.getUserSettings(normalizedTask.openid) : null;
    const userToken = String(user?.pushplusToken || "").trim();
    const finalToken = userToken || taskToken;

    if (!finalToken) {
      throw new Error("PushPlus 通知已开启，但用户尚未保存 PushPlus Token");
    }

    return finalToken;
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

  #withTaskCheckLock(taskId, runner) {
    const existing = this.taskCheckPromises.get(taskId);
    if (existing) {
      return existing;
    }

    const promise = Promise.resolve()
      .then(runner)
      .finally(() => {
        this.taskCheckPromises.delete(taskId);
      });
    this.taskCheckPromises.set(taskId, promise);
    return promise;
  }

  #isDuplicateHistoryRecord(record, histories = []) {
    const latest = histories[0];
    if (!latest) {
      return false;
    }

    // 金价任务每次检查都记历史，不做去重
    if (record.snapshot?.monitorType === "gold") {
      return false;
    }

    if ((latest.summary?.minPrice ?? null) !== (record.summary?.minPrice ?? null)) {
      return false;
    }

    const latestSignature = JSON.stringify(
      (latest.changes || []).map((change) => ({
        type: change.type,
        key: change.key,
        previous: change.previous ?? null,
        current: change.current ?? null,
        delta: change.delta ?? null
      }))
    );
    const recordSignature = JSON.stringify(
      (record.changes || []).map((change) => ({
        type: change.type,
        key: change.key,
        previous: change.previous ?? null,
        current: change.current ?? null,
        delta: change.delta ?? null
      }))
    );

    return latestSignature === recordSignature;
  }
}

module.exports = {
  MonitorService
};
