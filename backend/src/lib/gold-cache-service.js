const { JUHE_GOLD_API_URL, JUHE_GOLD_API_KEY, REQUEST_TIMEOUT_MS } = require("../config");
const { createId, isoNow } = require("./utils");

// 每 30 分钟抓取一次（毫秒）
const FETCH_INTERVAL_MS = 30 * 60 * 1000;

/**
 * GoldCacheService
 *
 * 独立于监控任务之外，每 30 分钟定时从聚合数据黄金 API 拉取一次价格，
 * 写入 CloudBase gold_price_cache 集合。
 * 监控任务通过 JuheGoldProvider 从该缓存读取价格，不再直接请求 API。
 */
class GoldCacheService {
  /**
   * @param {{ store: import('./cloudbase-store').CloudBaseStore }} opts
   */
  constructor({ store }) {
    this.store = store;
    this._timer = null;
    this._fetching = false;
  }

  start() {
    if (this._timer) return;

    // 启动后立即抓一次（带重试，指数退避最多等约 31 分钟）
    this._initialFetchWithRetry();

    this._timer = setInterval(() => {
      this._fetchAndStore().catch((err) =>
        console.error("[GoldCacheService] scheduled fetch failed:", err.message)
      );
    }, FETCH_INTERVAL_MS);

    console.log("[GoldCacheService] started, interval=30min");
  }

  /**
   * 启动后首次拉取：失败时按 1→2→4→8→16 分钟指数退避重试
   * 全部失败后放弃，等待下一个 30 分钟定时周期再试
   */
  async _initialFetchWithRetry() {
    const delays = [60_000, 120_000, 240_000, 480_000, 960_000];
    for (let i = 0; i <= delays.length; i++) {
      try {
        await this._fetchAndStore();
        console.log("[GoldCacheService] initial fetch succeeded");
        return;
      } catch (err) {
        if (i === delays.length) {
          console.error("[GoldCacheService] initial fetch failed after all retries:", err.message);
          return;
        }
        console.warn(`[GoldCacheService] initial fetch failed, retrying in ${delays[i] / 60000}min:`, err.message);
        await new Promise((r) => setTimeout(r, delays[i]));
      }
    }
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * 从聚合数据 API 拉取全部黄金品种数据并写入缓存
   */
  async _fetchAndStore() {
    if (this._fetching) return;
    this._fetching = true;

    try {
      const apiKey = JUHE_GOLD_API_KEY;
      if (!apiKey) {
        console.warn("[GoldCacheService] JUHE_GOLD_API_KEY not set, skipping");
        return;
      }

      const url = `${JUHE_GOLD_API_URL}?key=${apiKey}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let data;
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" }
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        data = await response.json();
      } finally {
        clearTimeout(timer);
      }

      // 聚合数据错误码检查
      if (data.error_code && data.error_code !== 0) {
        throw new Error(`聚合数据黄金接口错误: ${data.reason || data.error_code}`);
      }
      if (data.resultcode && data.resultcode !== "200") {
        throw new Error(`聚合数据黄金接口错误: ${data.reason || data.resultcode}`);
      }
      if (!data.result || !data.result[0]) {
        throw new Error(`聚合数据黄金接口返回数据异常: ${JSON.stringify(data)}`);
      }

      const rawData = data.result[0];
      const fetchedAt = isoNow();

      const cacheItem = {
        id: createId(),
        fetchedAt,
        varieties: rawData    // 保存原始全量品种数据，key 为 "1"/"2"/"4" 等
      };

      await this.store.writeGoldCache(cacheItem);
      console.log(`[GoldCacheService] fetched and cached gold prices at ${fetchedAt}`);
    } catch (err) {
      console.error("[GoldCacheService] fetch error:", err.message);
    } finally {
      this._fetching = false;
    }
  }
}

module.exports = { GoldCacheService };
