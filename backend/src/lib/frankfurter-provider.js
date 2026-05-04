const { REQUEST_TIMEOUT_MS } = require("../config");

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

class FrankfurterProvider {
  /**
   * Fetch exchange rate for a currency pair via Frankfurter API.
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

    const url = `https://api.frankfurter.dev/v2/rate/${base}/${quote}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`货币对 ${base}/${quote} 不存在或不受支持`);
        }
        throw new Error(`Frankfurter API 请求失败: ${response.status}`);
      }

      const data = await response.json();

      if (data.rate == null) {
        throw new Error(`Frankfurter API 返回数据异常: ${JSON.stringify(data)}`);
      }

      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

      return {
        monitorType: "exchange_rate",
        base,
        quote,
        rate: data.rate,
        date: dateStr,
        prices: {
          [dateStr]: { best: data.rate }
        },
        fetchedAt: new Date().toISOString()
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  FrankfurterProvider
};
