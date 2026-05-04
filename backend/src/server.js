const http = require("http");
const { URL } = require("url");
const { HOST, PORT, STORE_DRIVER, WX_APPID, WX_APPSECRET } = require("./config");
const { CloudBaseStore } = require("./lib/cloudbase-store");
const { CtripProvider } = require("./lib/ctrip-provider");
const { FrankfurterProvider } = require("./lib/frankfurter-provider");
const { MonitorService } = require("./lib/monitor-service");
const { PushPlusNotifier } = require("./lib/pushplus-notifier");
const { WxSubscribeNotifier } = require("./lib/wx-subscribe-notifier");
const { JsonStore } = require("./lib/store");
const { badRequest, notFound, parseBody, sendJson } = require("./lib/utils");

const store =
  STORE_DRIVER === "cloudbase" ? new CloudBaseStore() : new JsonStore();
const notifier = new PushPlusNotifier();
const wxSubscribeNotifier = new WxSubscribeNotifier();

// Composite provider: routes to the appropriate provider based on task type
const flightProvider = new CtripProvider();
const exchangeProvider = new FrankfurterProvider();
const provider = {
  fetchPrices(task) {
    const type = task.monitorType || "flight";
    if (type === "exchange_rate") return exchangeProvider.fetchPrices(task);
    return flightProvider.fetchPrices(task);
  }
};
const monitorService = new MonitorService({ store, provider, notifier, wxSubscribeNotifier });

function getTaskIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(check-now|history|events|clear-unread|subscribe-quota))?$/);
  if (!match) {
    return null;
  }

  return {
    taskId: match[1],
    action: match[2] || null
  };
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    return notFound(res);
  }

  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const { pathname } = url;

  try {
    if (pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        service: "flight-alert-mini-backend",
        version: "v2-event-opt",
        now: new Date().toISOString()
      });
    }

    // 微信登录：用 code 换取 openid
    if (pathname === "/api/auth/login" && req.method === "POST") {
      const body = await parseBody(req);
      const code = body.code;
      if (!code) {
        return badRequest(res, "缺少 code 参数");
      }
      if (!WX_APPID || !WX_APPSECRET) {
        return badRequest(res, "服务端未配置 WX_APPID 或 WX_APPSECRET");
      }

      try {
        const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}&secret=${WX_APPSECRET}&js_code=${code}&grant_type=authorization_code`;
        const wxRes = await fetch(wxUrl);
        const wxData = await wxRes.json();

        if (wxData.errcode) {
          return badRequest(res, `微信登录失败: ${wxData.errmsg || wxData.errcode}`);
        }

        return sendJson(res, 200, {
          openid: wxData.openid || "",
          session_key: wxData.session_key || ""
        });
      } catch (error) {
        return sendJson(res, 500, { message: `登录失败: ${error.message}` });
      }
    }

    if (pathname === "/api/tasks" && req.method === "GET") {
      const tasks = await monitorService.listTasks();
      return sendJson(res, 200, { items: tasks });
    }

    if (pathname === "/api/tasks" && req.method === "POST") {
      const body = await parseBody(req);
      const task = await monitorService.createTask(body);
      return sendJson(res, 201, task);
    }

    if (pathname === "/api/flight-prices" && req.method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const date = url.searchParams.get("date");
      const flightWay = url.searchParams.get("flightWay") || "Oneway";

      if (!from || !to || !date) {
        return badRequest(res, "缺少必要参数：from, to, date");
      }

      if (!/^[A-Za-z]{3}$/.test(from) || !/^[A-Za-z]{3}$/.test(to)) {
        return badRequest(res, "from/to 必须是 3 位 IATA 机场代码");
      }

      if (!/^\d{8}$/.test(date)) {
        return badRequest(res, "date 必须是 YYYYMMDD 格式");
      }

      const result = await provider.fetchFlightPrices({
        placeFrom: from.toUpperCase(),
        placeTo: to.toUpperCase(),
        departDate: date,
        flightWay
      });
      return sendJson(res, 200, result);
    }

    if (pathname === "/api/flight-schedule" && req.method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const date = url.searchParams.get("date");
      const flightWay = url.searchParams.get("flightWay") || "Oneway";

      if (!from || !to || !date) {
        return badRequest(res, "缺少必要参数：from, to, date");
      }

      if (!/^[A-Za-z]{3}$/.test(from) || !/^[A-Za-z]{3}$/.test(to)) {
        return badRequest(res, "from/to 必须是 3 位城市代码（如 BJS, SHA）");
      }

      if (!/^\d{8}$/.test(date)) {
        return badRequest(res, "date 必须是 YYYYMMDD 格式");
      }

      const result = await provider.fetchFlightSchedule({
        placeFrom: from.toUpperCase(),
        placeTo: to.toUpperCase(),
        departDate: date,
        flightWay
      });
      return sendJson(res, 200, result);
    }

    if (pathname === "/api/flight-search" && req.method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const date = url.searchParams.get("date");
      const flightWay = url.searchParams.get("flightWay") || "Oneway";

      if (!from || !to || !date) {
        return badRequest(res, "缺少必要参数：from, to, date");
      }

      if (!/^[A-Za-z]{3}$/.test(from) || !/^[A-Za-z]{3}$/.test(to)) {
        return badRequest(res, "from/to 必须是 3 位城市代码（如 BJS, SHA）");
      }

      if (!/^\d{8}$/.test(date)) {
        return badRequest(res, "date 必须是 YYYYMMDD 格式");
      }

      const result = await provider.fetchFlightSearch({
        placeFrom: from.toUpperCase(),
        placeTo: to.toUpperCase(),
        departDate: date,
        flightWay
      });
      return sendJson(res, 200, result);
    }

    if (pathname === "/api/flights" && req.method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const date = url.searchParams.get("date");
      const flightWay = url.searchParams.get("flightWay") || "Oneway";
      const directOnly = url.searchParams.get("directOnly") === "true";

      if (!from || !to || !date) {
        return badRequest(res, "缺少必要参数：from, to, date");
      }

      if (!/^[A-Za-z]{3}$/.test(from) || !/^[A-Za-z]{3}$/.test(to)) {
        return badRequest(res, "from/to 必须是 3 位 IATA 机场代码");
      }

      if (!/^\d{8}$/.test(date)) {
        return badRequest(res, "date 必须是 YYYYMMDD 格式");
      }

      const result = await provider.fetchFlightList({
        placeFrom: from.toUpperCase(),
        placeTo: to.toUpperCase(),
        departDate: date,
        flightWay,
        directOnly
      });
      return sendJson(res, 200, result);
    }

    // 停止所有任务（必须放在 getTaskIdFromPath 之前，否则会被当成任务ID）
    if (pathname === "/api/tasks/stop-all" && req.method === "POST") {
      const result = await monitorService.stopAllTasks();
      return sendJson(res, 200, result);
    }

    if (pathname === "/api/events" && req.method === "GET") {
      const items = await monitorService.getEvents();
      return sendJson(res, 200, { items });
    }

    const taskRoute = getTaskIdFromPath(pathname);
    if (!taskRoute) {
      return notFound(res);
    }

    if (req.method === "GET" && !taskRoute.action) {
      const task = await monitorService.getTask(taskRoute.taskId);
      if (!task) {
        return notFound(res, "任务不存在");
      }
      return sendJson(res, 200, task);
    }

    if (req.method === "PATCH" && !taskRoute.action) {
      const body = await parseBody(req);
      const task = await monitorService.updateTask(taskRoute.taskId, body);
      if (!task) {
        return notFound(res, "任务不存在");
      }
      return sendJson(res, 200, task);
    }

    if (req.method === "DELETE" && !taskRoute.action) {
      const task = await monitorService.deleteTask(taskRoute.taskId);
      if (!task) {
        return notFound(res, "任务不存在");
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && taskRoute.action === "check-now") {
      const result = await monitorService.checkTask(taskRoute.taskId);
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && taskRoute.action === "history") {
      const task = await monitorService.getTask(taskRoute.taskId);
      if (!task) {
        return notFound(res, "任务不存在");
      }
      const items = await monitorService.getHistory(taskRoute.taskId);
      return sendJson(res, 200, { items });
    }

    if (req.method === "GET" && taskRoute.action === "events") {
      const items = await monitorService.getEvents({ taskId: taskRoute.taskId });
      return sendJson(res, 200, { items });
    }

    if (req.method === "POST" && taskRoute.action === "clear-unread") {
      const task = await monitorService.clearUnread(taskRoute.taskId);
      if (!task) {
        return notFound(res, "任务不存在");
      }
      return sendJson(res, 200, task);
    }

    // 增加订阅消息配额（用户授权时调用）
    if (req.method === "POST" && taskRoute.action === "subscribe-quota") {
      const body = await parseBody(req);
      const amount = body.amount || 1;
      const task = await monitorService.addSubscribeQuota(taskRoute.taskId, amount);
      if (!task) {
        return notFound(res, "任务不存在");
      }
      return sendJson(res, 200, { subscribeQuota: task.subscribeQuota });
    }

    return notFound(res);
  } catch (error) {
    if (
      error.message.includes("不能为空") ||
      error.message.includes("必须") ||
      error.message.includes("仅支持") ||
      error.message.includes("Invalid JSON")
    ) {
      return badRequest(res, error.message);
    }

    console.error("request failed", error);
    return sendJson(res, 500, {
      message: error.message || "Internal Server Error"
    });
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

monitorService.init().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Flight Alert Mini backend listening on http://${HOST}:${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to initialize monitor service:", err);
  server.listen(PORT, HOST, () => {
    console.log(`Flight Alert Mini backend listening on http://${HOST}:${PORT} (store init failed)`);
  });
});
