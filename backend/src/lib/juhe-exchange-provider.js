const {
  JUHE_EXCHANGE_API_URL,
  JUHE_EXCHANGE_API_KEY,
  REQUEST_TIMEOUT_MS
} = require("../config");

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/**
 * Predefined cross-rate table: each entry maps { quote, code } to a
 * canonical (base, quote) pair in Juhe's dataset.
 *
 * Juhe's frate endpoint returns a fixed list of cross rates anchored
 * to USD:
 *   EURUSD  → 1 EUR = X USD   (so USD/EUR = 1/X)
 *   USDJPY  → 1 USD = X JPY
 *   USDCNY  → 1 USD = X CNY
 *   GBPUSD  → 1 GBP = X USD   (so USD/GBP = 1/X)
 *   AUDUSD  → 1 AUD = X USD   (so USD/AUD = 1/X)
 *   NZDUSD  → 1 NZD = X USD   (so USD/NZD = 1/X)
 *   USDCAD  → 1 USD = X CAD
 *   USDCHF  → 1 USD = X CHF
 *   USDHKD  → 1 USD = X HKD
 *   USDSGD  → 1 USD = X SGD
 *   USDMYR  → 1 USD = X MYR
 *   USDTWD  → 1 USD = X TWD
 *   DINIW   → US Dollar Index  (skip)
 *
 * For any pair we build a rate via USD as the intermediary:
 *   rate(base, quote) = rate(base, USD) * rate(USD, quote)
 * where rate(USD, X) is read directly from USDXxx entries,
 * and rate(X, USD) = 1 / closePri for XxUSD entries.
 */
const JUHE_CODES = new Set([
  "EURUSD", "USDJPY", "USDCNY", "GBPUSD", "AUDUSD",
  "NZDUSD", "USDCAD", "USDCHF", "USDHKD", "USDSGD",
  "USDMYR", "USDTWD", "DINIW"
]);

// Currencies available in Juhe frate
const JUHE_CURRENCIES = new Set([
  "USD", "EUR", "JPY", "CNY", "GBP", "AUD",
  "NZD", "CAD", "CHF", "HKD", "SGD", "MYR", "TWD"
]);

class JuheExchangeProvider {
  constructor() {
    // In-memory cache of the latest juhe response (keyed by code => rate value)
    this._cache = null;
    this._cacheTime = 0;
    this._CACHE_TTL_MS = 60_000; // 1 minute cache
  }

  /**
   * Fetch realtime exchange rate for a currency pair via Juhe API.
   * Returns a snapshot compatible with MonitorService's comparison logic.
   */
  async fetchPrices(task) {
    const base = (task.baseCurrency || "").toUpperCase();
    const quote = (task.quoteCurrency || "").toUpperCase();

    if (!CURRENCY_CODE_RE.test(base)) {
      throw new Error(`无效的基础货币代码: ${base}`);
    }
    if (!CURRENCY_CODE_RE.test(quote)) {
      throw new Error(`无效的报价货币代码: ${quote}`);
    }
    if (base === quote) {
      throw new Error(`基础货币和报价货币不能相同`);
    }
    if (!JUHE_EXCHANGE_API_KEY) {
      throw new Error("未配置 JUHE_EXCHANGE_API_KEY");
    }

    // Ensure we have fresh rates
    const rates = await this._fetchRates();

    // Build USD-based rate table
    const usdRates = this._buildUsdRateTable(rates);

    // Calculate the requested pair via USD cross
    const rate = this._crossRate(usdRates, base, quote);
    if (rate == null || !Number.isFinite(rate)) {
      throw new Error(
        `无法获取 ${base}/${quote} 汇率。` +
        `聚合数据支持以下货币: ${[...JUHE_CURRENCIES].join(", ")}`
      );
    }

    // Get date from the response
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

    return {
      monitorType: "exchange_rate",
      base,
      quote,
      rate,
      date: dateStr,
      prices: {
        [dateStr]: { best: rate }
      },
      fetchedAt: new Date().toISOString()
    };
  }

  /**
   * Fetch the full rate list from Juhe, with in-memory cache.
   * Returns the parsed `result[0]` object (keyed by dataN).
   */
  async _fetchRates() {
    const now = Date.now();
    if (this._cache && now - this._cacheTime < this._CACHE_TTL_MS) {
      return this._cache;
    }

    const url = `${JUHE_EXCHANGE_API_URL}?key=${JUHE_EXCHANGE_API_KEY}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        throw new Error(`聚合数据汇率 API 请求失败: ${response.status}`);
      }

      const data = await response.json();

      if (data.error_code && data.error_code !== 0) {
        const reason = data.reason || `错误码 ${data.error_code}`;
        throw new Error(`聚合数据汇率接口错误: ${reason}`);
      }

      const result = data.result;
      if (!Array.isArray(result) || !result.length || !result[0]) {
        throw new Error(`聚合数据汇率接口返回数据异常: ${JSON.stringify(data)}`);
      }

      this._cache = result[0];
      this._cacheTime = now;
      return this._cache;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Build a rate table mapping currency => rate vs 1 USD.
   * All rates expressed as: 1 USD = X units of currency
   */
  _buildUsdRateTable(rates) {
    const table = { USD: 1 };

    for (const key of Object.keys(rates)) {
      const item = rates[key];
      const code = item.code; // e.g. "EURUSD", "USDJPY"
      const closePri = parseFloat(item.closePri);
      if (!code || !Number.isFinite(closePri)) continue;

      // Skip non-currency entries like dollar index
      if (!JUHE_CODES.has(code)) continue;

      if (code.startsWith("USD")) {
        // USD/XXX: closePri is already "1 USD = X XXX"
        const currency = code.slice(3);
        table[currency] = closePri;
      } else if (code.endsWith("USD")) {
        // XXX/USD: closePri is "1 XXX = X USD", so USD/XXX = 1/closePri
        const currency = code.slice(0, 3);
        table[currency] = 1 / closePri;
      }
    }

    return table;
  }

  /**
   * Calculate rate for base/quote using USD as cross currency.
   * rate(base, quote) = rate(base, USD) * rate(USD, quote)
   * where rate(base, USD) = 1 / table[base]
   *   and rate(USD, quote) = table[quote]
   */
  _crossRate(usdTable, base, quote) {
    if (base === "USD") return usdTable[quote] || null;
    if (quote === "USD") return (usdTable[base] != null) ? 1 / usdTable[base] : null;

    const baseToUsd = usdTable[base];
    const usdToQuote = usdTable[quote];
    if (baseToUsd == null || usdToQuote == null) return null;

    // rate(base, USD) = 1/baseToUsd, rate(USD, quote) = usdToQuote
    return (1 / baseToUsd) * usdToQuote;
  }
}

module.exports = {
  JuheExchangeProvider
};
