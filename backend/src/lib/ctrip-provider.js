const {
  CTRIP_LOWEST_PRICE_URL,
  CTRIP_SCHEDULE_URL,
  JUHE_FLIGHT_API_URL,
  JUHE_FLIGHT_API_KEY,
  REQUEST_TIMEOUT_MS,
  CHROMIUM_PATH
} = require("../config");

let puppeteer = null;
try {
  puppeteer = require("puppeteer-core");
} catch {
  // puppeteer-core is optional; /api/flight-search will return error if not installed
}

class CtripProvider {
  /**
   * Search flight prices via headless browser (FREE).
   * Scrapes Ctrip search page to get per-flight prices.
   * Requires puppeteer-core + Chromium.
   */
  async fetchFlightSearch({ placeFrom, placeTo, departDate, flightWay = "Oneway" }) {
    if (!puppeteer) {
      throw new Error("浏览器搜索功能未安装（缺少 puppeteer-core 依赖）。请使用 /api/flight-schedule 接口查询航班时刻+航线最低价。");
    }

    const chromiumPath = CHROMIUM_PATH;
    if (!chromiumPath) {
      throw new Error("未配置 Chromium 路径（CHROMIUM_PATH 环境变量）。");
    }

    const formattedDate = `${departDate.slice(0, 4)}-${departDate.slice(4, 6)}-${departDate.slice(6, 8)}`;
    const tripType = flightWay === "Roundtrip" ? "round" : "oneway";
    const url = `https://flights.ctrip.com/online/list/${tripType}-${placeFrom}-${placeTo}?depdate=${formattedDate}&cabin=Y_S`;

    const startTime = Date.now();
    const browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1280,800"
      ]
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1280, height: 800 });

      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 5000));

      // Scroll down to load more flights
      await page.evaluate(() => window.scrollTo(0, 2000));
      await new Promise((r) => setTimeout(r, 2000));
      await page.evaluate(() => window.scrollTo(0, 4000));
      await new Promise((r) => setTimeout(r, 2000));

      const rawResult = await page.evaluate(() => {
        const results = [];

        // Find flight list container by looking for elements with flight-no + price
        const allEls = document.querySelectorAll("div, span, section");
        let flightListContainer = null;

        for (const el of allEls) {
          const children = el.children;
          if (children.length < 5) continue;

          let flightCount = 0;
          for (const child of children) {
            const childText = child.innerText || "";
            if (childText.match(/[A-Z]{2}\d{3,4}/) && childText.includes("¥")) {
              flightCount++;
            }
          }

          if (flightCount >= 3) {
            flightListContainer = el;
            break;
          }
        }

        // Debug info: page title, body text sample
        const debugInfo = {
          title: document.title,
          bodyTextLen: document.body.innerText.length,
          bodySnippet: document.body.innerText.substring(0, 1000),
          hasPriceClass: document.querySelectorAll(".price").length,
          hasFlightNo: document.body.innerText.match(/[A-Z]{2}\d{3,4}/g)?.slice(0, 5) || [],
          containerFound: !!flightListContainer
        };

        if (!flightListContainer) return { results, debugInfo };

        // Extract each flight item
        for (const item of flightListContainer.children) {
          const text = item.innerText || "";
          if (!text.match(/[A-Z]{2}\d{3,4}/) || !text.includes("¥")) continue;

          const lines = text.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
          const flightNoMatch = text.match(/([A-Z]{2}\d{3,4})/);
          // Match "¥450起" or "¥450" but not "减¥30" or "立减¥30"
          const priceMatch = text.match(/(?:^|[^减])(?:¥|￥)(\d+)起?/);
          const timePattern = /^(\d{2}:\d{2})$/;

          // Find times and airports from lines
          let departTime = "";
          let arriveTime = "";
          let departAirport = "";
          let arriveAirport = "";
          let airline = "";
          let aircraft = "";
          let discount = "";

          for (let i = 0; i < lines.length; i++) {
            if (timePattern.test(lines[i]) && !departTime) {
              departTime = lines[i];
              // Next non-empty line should be departure airport
              if (i + 1 < lines.length && lines[i + 1].includes("机场")) {
                departAirport = lines[i + 1];
              }
            } else if (timePattern.test(lines[i]) && departTime && !arriveTime) {
              arriveTime = lines[i];
              // Next non-empty line should be arrival airport
              if (i + 1 < lines.length && lines[i + 1].includes("机场")) {
                arriveAirport = lines[i + 1];
              }
            }
          }

          if (lines[0]) airline = lines[0].split(/\s/)[0];
          const aircraftMatch = text.match(/(波音|空客|ARJ|CRJ|ERJ|商飞)[^\s]*/);
          if (aircraftMatch) aircraft = aircraftMatch[0];
          const discountMatch = text.match(/经济舱([\d.]+折)/);
          if (discountMatch) discount = discountMatch[1];

          // Detect transfer flights
          const isTransfer = text.includes("转") || text.includes("中转");

          results.push({
            flightNo: flightNoMatch ? flightNoMatch[1] : "",
            airline,
            aircraft,
            departTime,
            arriveTime,
            departAirport,
            arriveAirport,
            price: priceMatch ? parseInt(priceMatch[1]) : null,
            discount,
            isDirect: !isTransfer
          });
        }

        return { results, debugInfo };
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const { results: flights, debugInfo } = rawResult;

      return {
        route: {
          from: placeFrom,
          to: placeTo,
          flightWay,
          date: departDate
        },
        total: flights.length,
        flights: flights.sort((a, b) => {
          if (a.price && b.price) return a.price - b.price;
          if (a.price) return -1;
          if (b.price) return 1;
          return a.departTime.localeCompare(b.departTime);
        }),
        scrapeTime: `${elapsed}s`,
        note: "数据通过浏览器自动化从携程搜索页实时抓取，包含各航班实时票价。价格仅供参考，以实际购买为准。注意：云端服务器IP可能被携程反爬，建议在本地运行。",
        fetchedAt: new Date().toISOString()
      };
    } finally {
      await browser.close();
    }
  }
  /**
   * Fetch flight schedule (free) combining Ctrip schedule API + lowestPrice API.
   * Returns flight list with metadata + route-level price info for the target date.
   */
  async fetchFlightSchedule({ placeFrom, placeTo, departDate, flightWay = "Oneway" }) {
    // Fetch schedule and price data in parallel
    const [scheduleData, priceData] = await Promise.all([
      this.#fetchSchedulePages(placeFrom, placeTo),
      this.#fetchPriceForDate(placeFrom, placeTo, departDate, flightWay)
    ]);

    // Filter flights that operate on the target day of week
    const dayOfWeek = this.#getDayOfWeek(departDate);
    const allFlights = scheduleData.filter(
      (f) => f.currentWeekSchedule && f.currentWeekSchedule[dayOfWeek] === true
    );

    // Deduplicate by flight number (code-share flights share the same physical flight)
    const seen = new Set();
    const flights = [];
    for (const f of allFlights) {
      if (seen.has(f.flightNo)) continue;
      seen.add(f.flightNo);
      flights.push({
        flightNo: f.flightNo,
        airline: f.airlineCompanyName,
        airlineCode: f.airlineCode,
        aircraftType: f.aircraftType,
        departTime: f.departTime,
        arriveTime: f.arriveTime,
        departPort: f.departPortName,
        departPortCode: f.departPortCode,
        departTerminal: f.departTerminal || "",
        arrivePort: f.arrivePortName,
        arrivePortCode: f.arrivePortCode,
        arriveTerminal: f.arriveTerminal || "",
        onTimeRate: f.onTimeRate,
        isCodeShare: false,
        scheduleDays: f.currentWeekSchedule,
        codeShareFlights: []
      });
    }

    // Group code-share flights (same route & time, different flight number/airline)
    const flightMap = new Map();
    for (const f of flights) {
      const key = `${f.departTime}-${f.arriveTime}-${f.departPortCode}-${f.arrivePortCode}`;
      if (!flightMap.has(key)) {
        flightMap.set(key, f);
      } else {
        const primary = flightMap.get(key);
        primary.codeShareFlights.push({
          flightNo: f.flightNo,
          airline: f.airline,
          airlineCode: f.airlineCode
        });
        primary.isCodeShare = true;
      }
    }

    const uniqueFlights = [...flightMap.values()].sort((a, b) =>
      a.departTime.localeCompare(b.departTime)
    );

    return {
      route: {
        from: placeFrom,
        to: placeTo,
        flightWay,
        date: departDate
      },
      price: priceData,
      total: uniqueFlights.length,
      flights: uniqueFlights,
      note: "航班时刻来自携程航班时刻表（免费），价格为该航线当日最低价参考，非具体航班票价。具体航班票价需在携程/航司APP查询。",
      fetchedAt: new Date().toISOString()
    };
  }

  /**
   * Fetch all schedule pages for a city pair.
   */
  async #fetchSchedulePages(departureCityCode, arriveCityCode) {
    const firstPage = await this.#fetchSchedulePage(departureCityCode, arriveCityCode, 1);
    const totalPage = firstPage.totalPage || 1;
    const allFlights = [...(firstPage.scheduleVOList || [])];

    if (totalPage > 1) {
      const pagePromises = [];
      for (let p = 2; p <= totalPage; p++) {
        pagePromises.push(this.#fetchSchedulePage(departureCityCode, arriveCityCode, p));
      }
      const pages = await Promise.all(pagePromises);
      for (const page of pages) {
        allFlights.push(...(page.scheduleVOList || []));
      }
    }

    return allFlights;
  }

  async #fetchSchedulePage(departureCityCode, arriveCityCode, pageNo) {
    const body = JSON.stringify({ departureCityCode, arriveCityCode, pageNo });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(CTRIP_SCHEDULE_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Referer": `https://flights.ctrip.com/schedule/${departureCityCode.toLowerCase()}.${arriveCityCode.toLowerCase()}.html`
        },
        body
      });

      if (!response.ok) {
        throw new Error(`Schedule API request failed with status ${response.status}`);
      }

      const data = await response.json();
      return data || {};
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch route-level price info for a specific date (combines direct + transfer).
   */
  async #fetchPriceForDate(placeFrom, placeTo, departDate, flightWay) {
    try {
      const params = new URLSearchParams({
        flightWay: flightWay === "Roundtrip" ? "Roundtrip" : "Oneway",
        dcity: placeFrom,
        acity: placeTo,
        army: "false"
      });

      const directParams = new URLSearchParams({
        ...Object.fromEntries(params),
        direct: "true"
      });

      const [baseData, directData] = await Promise.all([
        this.#requestWithParams(params),
        this.#requestWithParams(directParams)
      ]);

      const transferMap = baseData?.data?.oneWayPrice?.[0] || {};
      const directMap = directData?.data?.oneWayPrice?.[0] || {};

      const directPrice = Number(directMap[departDate] || 0) || null;
      const allPrice = Number(transferMap[departDate] || 0) || null;
      const transferPrice = (directPrice && allPrice && allPrice < directPrice) ? allPrice : null;

      const candidates = [directPrice, transferPrice].filter((p) => p !== null);
      if (candidates.length === 0) return null;

      return {
        date: departDate,
        directLowest: directPrice,
        transferLowest: transferPrice,
        bestLowest: Math.min(...candidates)
      };
    } catch {
      return null;
    }
  }

  #getDayOfWeek(dateStr) {
    // dateStr is YYYYMMDD, JS needs YYYY-MM-DD
    const d = new Date(
      `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
    );
    // JS: 0=Sun, 1=Mon... Ctrip schedule: 1=Mon, 7=Sun
    const jsDay = d.getDay();
    return jsDay === 0 ? 7 : jsDay;
  }
  /**
   * Fetch price info for a specific route and date (FREE - uses Ctrip lowestPrice API).
   * Returns direct vs. transfer lowest prices, plus a calendar view of nearby dates.
   */
  async fetchFlightPrices({ placeFrom, placeTo, departDate, flightWay = "Oneway" }) {
    const params = new URLSearchParams({
      flightWay: flightWay === "Roundtrip" ? "Roundtrip" : "Oneway",
      dcity: placeFrom,
      acity: placeTo,
      army: "false"
    });

    // Fetch both all-flights and direct-only snapshots in parallel
    const directParams = new URLSearchParams({
      ...Object.fromEntries(params),
      direct: "true"
    });

    const [baseData, directData] = await Promise.all([
      this.#requestWithParams(params),
      this.#requestWithParams(directParams)
    ]);

    const transferMap = baseData?.data?.oneWayPrice?.[0] || {};
    const directMap = directData?.data?.oneWayPrice?.[0] || {};

    // Target date price
    const directPrice = Number(directMap[departDate] || 0) || null;
    const transferPrice = (() => {
      const all = Number(transferMap[departDate] || 0) || null;
      // If direct price exists and equals the all-flights price, transfer might not be cheaper
      if (directPrice && all && all >= directPrice) {
        return null;
      }
      return all;
    })();

    const best = [directPrice, transferPrice].filter((p) => p !== null);
    const targetPrice = best.length
      ? {
          date: departDate,
          direct: directPrice,
          transfer: transferPrice,
          best: Math.min(...best)
        }
      : null;

    // Calendar: prices for nearby dates (the API returns ~130 days)
    const calendar = [];
    const allDates = new Set([
      ...Object.keys(transferMap),
      ...Object.keys(directMap)
    ]);

    for (const date of allDates) {
      const d = Number(directMap[date] || 0) || null;
      const t = Number(transferMap[date] || 0) || null;
      const candidates = [d, t].filter((p) => p !== null);

      if (candidates.length === 0) {
        continue;
      }

      calendar.push({
        date,
        direct: d,
        transfer: t,
        best: Math.min(...candidates)
      });
    }

    calendar.sort((a, b) => a.date.localeCompare(b.date));

    return {
      route: {
        from: placeFrom,
        to: placeTo,
        flightWay
      },
      targetDate: targetPrice,
      calendar,
      note: "价格为携程最低价（直飞/中转分别取最低），非具体航班票价。如需查询具体航班号和时刻，请配置 JUHE_FLIGHT_API_KEY 后使用 /api/flights 接口。",
      fetchedAt: new Date().toISOString()
    };
  }

  /**
   * Fetch detailed flight list for a specific route and date via Juhe API.
   * Requires JUHE_FLIGHT_API_KEY environment variable (paid API).
   */
  async fetchFlightList({ placeFrom, placeTo, departDate, flightWay = "Oneway", directOnly = false }) {
    if (!JUHE_FLIGHT_API_KEY) {
      throw new Error("航班列表查询需要配置 JUHE_FLIGHT_API_KEY 环境变量（聚合数据 API Key，0.1元/次）。如仅需价格信息，请使用免费的 /api/flight-prices 接口。");
    }

    const formattedDate = `${departDate.slice(0, 4)}-${departDate.slice(4, 6)}-${departDate.slice(6, 8)}`;
    const params = new URLSearchParams({
      key: JUHE_FLIGHT_API_KEY,
      departure: placeFrom,
      arrival: placeTo,
      departureDate: formattedDate,
      maxSegments: directOnly ? "1" : "0"
    });

    const url = `${JUHE_FLIGHT_API_URL}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        throw new Error(`Juhe API request failed with status ${response.status}`);
      }

      const data = await response.json();

      if (data.error_code !== 0) {
        throw new Error(data.reason || `Juhe API error: ${data.error_code}`);
      }

      return this.#normalizeJuheFlightList(data);
    } finally {
      clearTimeout(timer);
    }
  }

  #normalizeJuheFlightList(data) {
    const flightInfo = data?.result?.flightInfo || [];

    const flights = flightInfo.map((item) => ({
      flightNo: item.flightNo || "",
      airline: item.airlineName || "",
      airlineCode: item.airline || "",
      craftType: item.equipment || "",
      departAirport: item.departure || "",
      departAirportName: item.departureName || "",
      departDate: item.departureDate || "",
      departTime: item.departureTime || "",
      arriveAirport: item.arrival || "",
      arriveAirportName: item.arrivalName || "",
      arriveDate: item.arrivalDate || "",
      arriveTime: item.arrivalTime || "",
      duration: item.duration || "",
      isDirect: Number(item.transferNum || 0) <= 1,
      transferNum: Number(item.transferNum || 0),
      referencePrice: Number(item.ticketPrice || 0),
      isCodeShare: Boolean(item.isCodeShare),
      segments: (item.segments || []).map((seg) => ({
        flightNo: seg.flightNo || "",
        airline: seg.airline || "",
        opAirline: seg.opAirline || "",
        opFlightNo: seg.opFlightNo || "",
        equipment: seg.equipment || "",
        departure: seg.departure || "",
        departureName: seg.departureName || "",
        departureDate: seg.departureDate || "",
        departureTime: seg.departureTime || "",
        arrival: seg.arrival || "",
        arrivalName: seg.arrivalName || "",
        arrivalDate: seg.arrivalDate || "",
        arrivalTime: seg.arrivalTime || "",
        flightTime: seg.flightTime || ""
      }))
    }));

    return {
      total: flights.length,
      flights: flights.sort((a, b) => {
        if (a.referencePrice > 0 && b.referencePrice > 0) {
          return a.referencePrice - b.referencePrice;
        }
        if (a.referencePrice > 0) return -1;
        if (b.referencePrice > 0) return 1;
        return a.departTime.localeCompare(b.departTime);
      })
    };
  }

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
