const {
  JUHE_GOLD_API_URL,
  JUHE_GOLD_API_KEY,
  REQUEST_TIMEOUT_MS
} = require("../config");
const { createId, isoNow } = require("./utils");

const GOLD_DEFAULT_KEY = "shgold";

// 缓存超过这个时间（毫秒）视为过期，回退到 API
const CACHE_STALE_MS = 60 * 60 * 1000; // 1 小时

/**
 * Juhe Gold Price Provider
 * Data source: Shanghai Gold Exchange (上海黄金交易所)
 *
 * 优先从 store（gold_price_cache 集合）读取最新缓存；
 * 仅在缓存缺失或超过 1 小时未更新时，才直接请求聚合数据 API（兜底）。
 * 正常情况下，GoldCacheService 每 30 分钟刷新一次缓存，这里几乎不会命中 API。
 */
class JuheGoldProvider {
  /**
   * @param {{ store?: import('./cloudbase-store').CloudBaseStore }} [opts]
   */
  constructor(opts = {}) {
    this.store = opts.store || null;

    // 内存缓存（仅兜底直连时使用）
    this._memCache = null;
    this._memCacheTime = 0;
    this._MEM_CACHE_TTL_MS = 60_000; // 1 分钟，防止同一分钟内反复直连
  }

  /**
   * Fetch gold price for a task.
   * Returns a snapshot compatible with MonitorService comparison logic.
   */
  async fetchPrices(task) {
    const apiKey = JUHE_GOLD_API_KEY;
    if (!apiKey) {
      throw new Error("未配置 JUHE_GOLD_API_KEY");
    }

    const rates = await this._getRates(apiKey);

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
      limit: item.limit || "0%",
      prevClose: parseFloat(item.yespri) || null,
      volume: parseFloat(item.totalvol) || null,
      time: item.time || now.toISOString(),
      date: dateStr,
      prices: {
        [dateStr]: { best: latestPrice }
      },
      fetchedAt: now.toISOString()
    };
  }

  /**
   * 获取金价品种数据：优先读 store 缓存，缓存缺失/过期时回退 API 并写入缓存
   */
  async _getRates(apiKey) {
    // 1. 优先读 store 缓存（由 GoldCacheService 定时写入）
    if (this.store && typeof this.store.getLatestGoldCache === "function") {
      try {
        const cached = await this.store.getLatestGoldCache();
        if (cached && cached.varieties && cached.fetchedAt) {
          const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
          if (ageMs < CACHE_STALE_MS) {
            return cached.varieties;
          }
          console.warn(`[JuheGoldProvider] cache stale (${Math.round(ageMs / 60000)}min), falling back to API`);
        }
      } catch (err) {
        console.warn("[JuheGoldProvider] cache read failed, falling back to API:", err.message);
      }
    }

    // 2. 回退：直连 API（内存缓存 1 分钟防重复请求）
    const rates = await this._fetchRatesFromAPI(apiKey);

    // 3. API 成功后异步写入缓存，供后续任务复用
    this._backfillCache(rates).catch((err) =>
      console.warn("[JuheGoldProvider] backfill cache failed:", err.message)
    );

    return rates;
  }

  /**
   * 将 API 拿到的数据回写到缓存集合
   */
  async _backfillCache(varieties) {
    if (!this.store || typeof this.store.writeGoldCache !== "function") return;
    try {
      await this.store.writeGoldCache({
        id: createId(),
        fetchedAt: isoNow(),
        varieties
      });
      console.log("[JuheGoldProvider] backfilled gold cache from API result");
    } catch (err) {
      // 非致命，仅 warn
    }
  }

  /**
   * 直连聚合数据 API，附带内存短缓存防止同分钟内重复调用
   */
  async _fetchRatesFromAPI(apiKey) {
    const now = Date.now();
    if (this._memCache && now - this._memCacheTime < this._MEM_CACHE_TTL_MS) {
      return this._memCache;
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

      this._memCache = data.result[0];
      this._memCacheTime = now;
      return this._memCache;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  JuheGoldProvider
};
