const { request } = require("./request");
const { ensureOpenid } = require("./subscribe");

const DEFAULT_SILENT_START = "00:00";
const DEFAULT_SILENT_END = "08:00";

function normalizeTimeText(value, fallback) {
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

function formatSilentRange(user) {
  return `${user.silentStart} - ${user.silentEnd}`;
}

async function getUserSettings() {
  const openid = await ensureOpenid();
  if (!openid) {
    throw new Error("获取用户身份失败");
  }

  const user = await request({
    url: `/users/me?openid=${encodeURIComponent(openid)}`
  });
  return {
    ...user,
    openid,
    silentStart: normalizeTimeText(user.silentStart, DEFAULT_SILENT_START),
    silentEnd: normalizeTimeText(user.silentEnd, DEFAULT_SILENT_END)
  };
}

async function saveUserSettings(patch) {
  const openid = patch?.openid || await ensureOpenid();
  if (!openid) {
    throw new Error("获取用户身份失败");
  }

  const user = await request({
    url: "/users/me",
    method: "PATCH",
    data: {
      ...patch,
      openid
    }
  });

  return {
    ...user,
    openid,
    silentStart: normalizeTimeText(user.silentStart, DEFAULT_SILENT_START),
    silentEnd: normalizeTimeText(user.silentEnd, DEFAULT_SILENT_END)
  };
}

module.exports = {
  DEFAULT_SILENT_START,
  DEFAULT_SILENT_END,
  formatSilentRange,
  getUserSettings,
  normalizeTimeText,
  saveUserSettings
};
