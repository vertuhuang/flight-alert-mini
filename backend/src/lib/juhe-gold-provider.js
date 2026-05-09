const {
  JUHE_GOLD_API_URL,
  JUHE_GOLD_API_KEY,
  REQUEST_TIMEOUT_MS
} = require("../config");

const GOLD_DEFAULT_KEY = "shgold";

/**
 * Juhe Gold Price Provider
 * Data source: Shanghai Gold Exchange (上海黄金交易所)
 * API: http://web.juhe.cn:8080/finance/gold/shgold
 *
 * Returns snapshot compatible with MonitorService comparison logic.
 * Gold price changes are tracked with a fixed key (same logic as exchange_rate).
 */
class JuheGoldProvider {
  constructor() {
    this._cache = null;
    this._cacheTime = 0;
    this._CACHE_TTL_MS = 60_000; // 1 minute cache
  }

  /**
   * Fetch gold price for a task.
   * Returns a snapshot: { monitorType: "gold", price, variety, time, ... }
   */
  async fetchPrices(task) {
    const apiKey = JUHE_GOLD_API_KEY;
    if (!apiKey) {
      throw new Error("未配置 JUHE_GOLD_API_KEY");
    }

    const rates = await this._fetchRates(apiKey);

    // Use the first available gold variety (key "1" is usually Au99.99)
    const varietyKey = task.goldVarietyKey || "4";
    const item = rates[varietyKey];

    if (!item) {
      const available = Object.keys(rates).filter(k => k !== "resultcode" && k !== "reason");
      throw new Error(
        `无法获取金价数据（品种: ${varietyKey}）。可用品种: ${available.join(", ") || "无"}`
      );
    }

    const latestPrice = parseFloat(item.latestpri);
    if (!Number.isFinite(latestPrice)) {
      throw new Error(`金价数据异常: latestpri=${item.latestpri}`);
    }

    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

    return {
      monitorType: "gold",
      variety: item.variety || "黄金",
      varietyKey,
      price: latestPrice,
      open: parseFloat(item.openpri) || null,
      high: parseFloat(item.maxpri) || null,
      low: parseFloat(item.minpri) || null,
      limit: item.limit || "0%",        // e.g. "-1.52%"
      prevClose: parseFloat(item.yespri) || null,
      volume: parseFloat(item.totalvol) || null,
      time: item.time || new Date().toISOString(),
      date: dateStr,
      prices: {
        [dateStr]: { best: latestPrice }
      },
      fetchedAt: new Date().toISOString()
    };
  }

  /**
   * Fetch the full gold list from Juhe, with in-memory cache.
   * Returns the parsed `result[0]` object (keyed by "1", "2", "7", etc.).
   */
  async _fetchRates(apiKey) {
    const now = Date.now();
    if (this._cache && now - this._cacheTime < this._CACHE_TTL_MS) {
      return this._cache;
    }

    const url = `${JUHE_GOLD_API_URL}?key=${apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        throw new Error(`聚合数据黄金 API 请求失败: ${response.status}`);
      }

      const data = await response.json();

      if (data.error_code && data.error_code !== 0) {
        const reason = data.reason || `错误码 ${data.error_code}`;
        throw new Error(`聚合数据黄金接口错误: ${reason}`);
      }

      if (data.resultcode && data.resultcode !== "200") {
        const reason = data.reason || `resultcode ${data.resultcode}`;
        throw new Error(`聚合数据黄金接口错误: ${reason}`);
      }

      if (!data.result || !data.result[0]) {
        throw new Error(`聚合数据黄金接口返回数据异常: ${JSON.stringify(data)}`);
      }

      this._cache = data.result[0];
      this._cacheTime = now;
      return this._cache;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  JuheGoldProvider
};
