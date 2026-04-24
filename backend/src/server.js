const http = require("http");
const { URL } = require("url");
const { HOST, PORT, STORE_DRIVER } = require("./config");
const { CloudBaseStore } = require("./lib/cloudbase-store");
const { CtripProvider } = require("./lib/ctrip-provider");
const { MonitorService } = require("./lib/monitor-service");
const { PushPlusNotifier } = require("./lib/pushplus-notifier");
const { JsonStore } = require("./lib/store");
const { badRequest, notFound, parseBody, sendJson } = require("./lib/utils");

const store =
  STORE_DRIVER === "cloudbase" ? new CloudBaseStore() : new JsonStore();
const provider = new CtripProvider();
const notifier = new PushPlusNotifier();
const monitorService = new MonitorService({ store, provider, notifier });

function getTaskIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(check-now|history))?$/);
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
        now: new Date().toISOString()
      });
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

monitorService.init().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Flight Alert Mini backend listening on http://${HOST}:${PORT}`);
  });
});
