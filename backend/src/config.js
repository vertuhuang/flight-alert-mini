const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "db.json");

module.exports = {
  PORT: Number(process.env.PORT || 8787),
  HOST: process.env.HOST || "0.0.0.0",
  DATA_FILE,
  STORE_DRIVER: process.env.STORE_DRIVER || "file",
  CLOUDBASE_ENV_ID: process.env.CLOUDBASE_ENV_ID || "cloud1-d3gu5h3dk5e16d52b",
  TASKS_COLLECTION: process.env.TASKS_COLLECTION || "flight_alert_tasks",
  HISTORIES_COLLECTION:
    process.env.HISTORIES_COLLECTION || "flight_alert_histories",
  EVENTS_COLLECTION: process.env.EVENTS_COLLECTION || "flight_alert_events",
  CTRIP_LOWEST_PRICE_URL:
    "https://flights.ctrip.com/itinerary/api/12808/lowestPrice",
  CTRIP_SCHEDULE_URL:
    "https://flights.ctrip.com/schedule/getScheduleByCityPair",
  JUHE_FLIGHT_API_URL:
    "https://apis.juhe.cn/flight/query",
  JUHE_FLIGHT_API_KEY:
    process.env.JUHE_FLIGHT_API_KEY || "",
  PUSHPLUS_URL: "https://www.pushplus.plus/send",
  // WeChat subscribe message config
  WX_APPID: process.env.WX_APPID || "",
  WX_APPSECRET: process.env.WX_APPSECRET || "",
  SUBSCRIBE_TEMPLATE_ID: process.env.SUBSCRIBE_TEMPLATE_ID || "9sSdwh_lZfkNgQPzpcwD4bNbofTq0RIrnTU9LeLmrEM",
  CHROMIUM_PATH: process.env.CHROMIUM_PATH || "",
  REQUEST_TIMEOUT_MS: 10000,
  DEFAULT_CHECK_INTERVAL_SEC: 600,
  DEFAULT_THRESHOLD: 50,
  SCHEDULER_TICK_MS: 15000
};
