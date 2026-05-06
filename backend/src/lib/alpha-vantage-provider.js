const {
  ALPHA_VANTAGE_API_KEY,
  ALPHA_VANTAGE_API_URL,
  REQUEST_TIMEOUT_MS
} = require("../config");

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

class AlphaVantageProvider {
  /**
   * Fetch realtime exchange rate for a currency pair via Alpha Vantage.
   * Returns a snapshot compatible with MonitorService's comparison logic.
   */
  async fetchPrices(task) {
    const base = task.baseCurrency ? task.baseCurrency.toUpperCase() : "";
    const quote = task.quoteCurrency ? task.quoteCurrency.toUpperCase() : "";

    if (!CURRENCY_CODE_RE.test(base)) {
      throw new Error(`无效的基础货币代码: ${base}`);
    }
    if (!CURRENCY_CODE_RE.test(quote)) {
      throw new Error(`无效的报价货币代码: ${quote}`);
    }
    if (!ALPHA_VANTAGE_API_KEY) {
      throw new Error("未配置 ALPHA_VANTAGE_API_KEY");
    }

    const url = new URL(ALPHA_VANTAGE_API_URL);
    url.searchParams.set("function", "CURRENCY_EXCHANGE_RATE");
    url.searchParams.set("from_currency", base);
    url.searchParams.set("to_currency", quote);
    url.searchParams.set("apikey", ALPHA_VANTAGE_API_KEY);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        throw new Error(`Alpha Vantage API 请求失败: ${response.status}`);
      }

      const data = await response.json();
      const exchange = data["Realtime Currency Exchange Rate"];

      if (data["Error Message"]) {
        throw new Error(`货币对 ${base}/${quote} 不存在或不受支持`);
      }
      if (data.Note || data.Information) {
        throw new Error(data.Note || data.Information);
      }
      if (!exchange) {
        throw new Error(`Alpha Vantage API 返回数据异常: ${JSON.stringify(data)}`);
      }

      const rate = Number(exchange["5. Exchange Rate"]);
      if (!Number.isFinite(rate)) {
        throw new Error(`Alpha Vantage API 汇率字段异常: ${JSON.stringify(exchange)}`);
      }

      const refreshedAt = exchange["6. Last Refreshed"] || "";
      const datePart = refreshedAt ? refreshedAt.slice(0, 10).replace(/-/g, "") : "";
      const now = new Date();
      const fallbackDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      const dateStr = /^\d{8}$/.test(datePart) ? datePart : fallbackDate;

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
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  AlphaVantageProvider
};
