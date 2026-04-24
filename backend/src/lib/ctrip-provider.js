const { CTRIP_LOWEST_PRICE_URL, REQUEST_TIMEOUT_MS } = require("../config");

class CtripProvider {
  async fetchPrices(task) {
    const params = new URLSearchParams({
      flightWay: task.flightWay,
      dcity: task.placeFrom,
      acity: task.placeTo,
      army: "false"
    });

    const directSnapshot =
      task.flightWay === "Oneway"
        ? await this.#requestWithParams(new URLSearchParams({
            ...Object.fromEntries(params),
            direct: "true"
          }))
        : null;

    const baseSnapshot = await this.#requestWithParams(params);

    if (task.flightWay === "Roundtrip") {
      return this.#normalizeRoundtrip(task, baseSnapshot);
    }

    return this.#normalizeOneWay(task, baseSnapshot, directSnapshot);
  }

  async #requestWithParams(params) {
    const url = `${CTRIP_LOWEST_PRICE_URL}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Ctrip request failed with status ${response.status}`);
      }

      const data = await response.json();
      if (data.status !== 0) {
        throw new Error(data.msg || "Ctrip returned non-zero status");
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  #normalizeOneWay(task, baseSnapshot, directSnapshot) {
    const transferMap = baseSnapshot?.data?.oneWayPrice?.[0] || {};
    const directMap = directSnapshot?.data?.oneWayPrice?.[0] || {};
    const prices = {};

    for (const date of task.departDates) {
      const direct = Number(directMap[date] || 0);
      const transfer = Number(transferMap[date] || 0);
      const candidates = [direct, transfer].filter((item) => item > 0);

      if (!candidates.length) {
        continue;
      }

      prices[date] = {
        direct: direct || null,
        transfer: transfer || null,
        best: Math.min(...candidates)
      };
    }

    return {
      flightWay: "Oneway",
      prices,
      fetchedAt: new Date().toISOString()
    };
  }

  #normalizeRoundtrip(task, baseSnapshot) {
    const matrix = baseSnapshot?.data?.roundTripPrice || {};
    const prices = {};

    for (const departDate of task.departDates) {
      const returnMap = matrix[departDate] || {};
      const filteredReturns = {};

      for (const returnDate of task.returnDates) {
        const price = Number(returnMap[returnDate] || 0);
        if (price > 0) {
          filteredReturns[returnDate] = price;
        }
      }

      if (Object.keys(filteredReturns).length) {
        prices[departDate] = filteredReturns;
      }
    }

    return {
      flightWay: "Roundtrip",
      prices,
      fetchedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  CtripProvider
};
