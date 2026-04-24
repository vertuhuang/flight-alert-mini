function createId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isoNow() {
  return new Date().toISOString();
}

function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function notFound(res, message = "Not Found") {
  sendJson(res, 404, { message });
}

function badRequest(res, message) {
  sendJson(res, 400, { message });
}

function normalizeDateList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function isValidDateCode(value) {
  return /^\d{8}$/.test(value);
}

function formatDateCode(value) {
  if (!isValidDateCode(value)) {
    return value;
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function buildSummaryFromSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  if (snapshot.flightWay === "Roundtrip") {
    const combos = Object.values(snapshot.prices || {}).flatMap((departMap) =>
      Object.values(departMap)
    );
    if (!combos.length) {
      return { minPrice: null, routeCount: 0 };
    }

    return {
      minPrice: Math.min(...combos),
      routeCount: combos.length
    };
  }

  const items = Object.values(snapshot.prices || {});
  if (!items.length) {
    return { minPrice: null, routeCount: 0 };
  }

  return {
    minPrice: Math.min(...items.map((item) => item.best)),
    routeCount: items.length
  };
}

module.exports = {
  badRequest,
  buildSummaryFromSnapshot,
  createId,
  formatDateCode,
  isValidDateCode,
  isoNow,
  normalizeDateList,
  notFound,
  parseBody,
  safeJsonParse,
  sendJson
};
