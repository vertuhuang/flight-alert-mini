/**
 * 微信小程序订阅消息工具模块
 *
 * 用于请求用户订阅消息授权，获取 openid 等功能。
 * 订阅消息为一次性消费：每次授权仅允许发送一条消息。
 */

const { request } = require("./request");

const SUBSCRIBE_TEMPLATE_ID = "9sSdwh_lZfkNgQPzpcwD4bNbofTq0RIrnTU9LeLmrEM";

/**
 * 请求用户订阅消息授权
 * @param {string[]} [templateIds] - 模板 ID 列表，默认使用配置的模板
 * @returns {Promise<Object>} 授权结果，包含每个模板的授权状态
 */
function requestSubscribe(templateIds) {
  const ids = templateIds || (SUBSCRIBE_TEMPLATE_ID ? [SUBSCRIBE_TEMPLATE_ID] : []);

  if (!ids.length) {
    console.warn("未配置订阅消息模板 ID，请在 subscribe.js 或微信公众平台配置");
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success(res) {
        console.log("订阅消息授权结果:", res);
        resolve(res);
      },
      fail(err) {
        console.warn("订阅消息授权失败:", err);
        resolve({});
      }
    });
  });
}

/**
 * 通过 wx.login + 后端 API 获取用户 openid
 * @returns {Promise<string>} openid
 */
async function getOpenid() {
  try {
    const loginRes = await new Promise((resolve, reject) => {
      wx.login({
        success: resolve,
        fail: reject
      });
    });

    if (!loginRes.code) {
      console.warn("wx.login 未返回 code");
      return "";
    }

    const res = await request({
      url: "/auth/login",
      method: "POST",
      data: { code: loginRes.code }
    });

    const openid = res.openid || "";
    if (openid) {
      wx.setStorageSync("wx_openid", openid);
    }
    return openid;
  } catch (error) {
    console.warn("获取 openid 失败:", error);
    // 尝试使用缓存的 openid
    return wx.getStorageSync("wx_openid") || "";
  }
}

/**
 * 获取缓存的 openid，如果没有则重新获取
 * @returns {Promise<string>} openid
 */
async function ensureOpenid() {
  const cached = wx.getStorageSync("wx_openid");
  if (cached) return cached;
  return getOpenid();
}

/**
 * 记录订阅时间
 * @param {string} taskId - 任务 ID
 */
function markSubscribed(taskId) {
  const key = `subscribe_${taskId}`;
  wx.setStorageSync(key, Date.now());
}

/**
 * 清除订阅记录（消息发送后调用）
 * @param {string} taskId - 任务 ID
 */
function clearSubscribeRecord(taskId) {
  const key = `subscribe_${taskId}`;
  wx.removeStorageSync(key);
}

module.exports = {
  SUBSCRIBE_TEMPLATE_ID,
  requestSubscribe,
  getOpenid,
  ensureOpenid,
  markSubscribed,
  clearSubscribeRecord
};
