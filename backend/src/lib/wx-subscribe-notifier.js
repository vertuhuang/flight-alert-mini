const { WX_APPID, WX_APPSECRET, SUBSCRIBE_TEMPLATE_ID, REQUEST_TIMEOUT_MS } = require("../config");

/**
 * WeChat Mini Program Subscribe Message Notifier
 *
 * Sends subscribe messages via WeChat API (subscribeMessage.send).
 * Requires:
 *   - WX_APPID / WX_APPSECRET for access_token
 *   - SUBSCRIBE_TEMPLATE_ID for the message template
 *   - User's openid stored in the task
 *
 * Note: Subscribe messages are one-time use per user authorization.
 * Each call to wx.requestSubscribeMessage on the frontend grants one credit.
 */
class WxSubscribeNotifier {
  constructor() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Get a valid access_token, refreshing if expired.
   */
  async #getAccessToken() {
    if (!WX_APPID || !WX_APPSECRET) {
      throw new Error("WX_APPID 或 WX_APPSECRET 未配置");
    }

    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WX_APPID}&secret=${WX_APPSECRET}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal
      });

      const data = await response.json();
      if (data.errcode) {
        throw new Error(`WeChat access_token error: ${data.errcode} ${data.errmsg}`);
      }

      this.accessToken = data.access_token;
      // Expire 5 minutes early to avoid edge cases
      this.tokenExpiresAt = now + (data.expires_in - 300) * 1000;
      return this.accessToken;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send a subscribe message to a user.
   *
   * @param {Object} options
   * @param {string} options.openid - User's openid in the mini program
   * @param {string} options.templateId - Template ID (falls back to config default)
   * @param {Object} options.data - Template data (key-value matching template fields)
   * @param {string} [options.page] - Page to navigate to when user taps the message
   * @returns {Object} Send result
   */
  async send({ openid, templateId, data, page }) {
    if (!openid) {
      return { skipped: true, reason: "missing_openid" };
    }

    const tid = templateId || SUBSCRIBE_TEMPLATE_ID;
    if (!tid) {
      return { skipped: true, reason: "missing_template_id" };
    }

    try {
      const token = await this.#getAccessToken();
      const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`;

      const body = {
        touser: openid,
        template_id: tid,
        data,
        miniprogram_state: "formal",
        lang: "zh_CN"
      };

      if (page) {
        body.page = page;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        const result = await response.json();

        if (result.errcode === 0) {
          return { ok: true, errcode: 0 };
        }

        // Common error codes:
        // 43101: user has not subscribed / subscription expired
        // 40003: invalid openid
        // 41028: form_id invalid (not relevant for subscribe messages)
        return {
          ok: false,
          errcode: result.errcode,
          errmsg: result.errmsg
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Build template data for a price change notification.
   * Template fields should match the template you configured in WeChat backend.
   *
   * Template: "机票价格变动提醒"
   * Fields:
   *   character_string1: 编号 (出发地→目的地 日期)
   *   amount4: 当前价格
   *   time11: 价格变动时间
   *   amount14: 商品差价
   */
  static buildPriceChangeData(task, changes, fromCity, toCity) {
    const from = fromCity || task.placeFrom;
    const to = toCity || task.placeTo;
    const route = `${from}→${to}`;
    const dates = task.departDates ? task.departDates.join(",") : "";
    
    // 编号：出发地→目的地（日期）
    const code = `${route}（${dates}）`.slice(0, 32);
    
    // 当前价格
    const currentPrice = changes.length > 0 ? `${changes[0].current}` : "暂无";
    
    // 价格变动时间
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    
    // 商品差价（取第一个变动的差值）
    const diff = changes.length > 0 ? `${Math.abs(changes[0].delta)}` : "0";

    return {
      character_string1: { value: code },
      amount4: { value: currentPrice },
      time11: { value: timeStr },
      amount14: { value: diff }
    };
  }

  /**
   * Build template data for a task creation notification.
   * Template: "机票价格变动提醒"
   * Fields:
   *   character_string1: 编号 (出发地→目的地 日期)
   *   amount4: 当前价格
   *   time11: 价格变动时间
   *   amount14: 商品差价
   */
  static buildTaskCreatedData(task, summary, fromCity, toCity) {
    const from = fromCity || task.placeFrom;
    const to = toCity || task.placeTo;
    const route = `${from}→${to}`;
    const dates = task.departDates ? task.departDates.join(",") : "";
    
    // 编号：出发地→目的地（日期）
    const code = `${route}（${dates}）`.slice(0, 32);
    
    // 当前价格
    const minPrice = summary?.minPrice ? `${summary.minPrice}` : "暂无";
    
    // 价格变动时间
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    
    // 任务创建时差价为 0
    const diff = "0";

    return {
      character_string1: { value: code },
      amount4: { value: minPrice },
      time11: { value: timeStr },
      amount14: { value: diff }
    };
  }
}

module.exports = { WxSubscribeNotifier };
