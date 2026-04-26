const { PUSHPLUS_URL, REQUEST_TIMEOUT_MS } = require("../config");

class PushPlusNotifier {
  async send({ token, title, content }) {
    if (!token) {
      return { skipped: true, reason: "missing_token" };
    }

    const url = new URL(PUSHPLUS_URL);
    url.searchParams.set("token", token);
    url.searchParams.set("title", title);
    url.searchParams.set("content", content);
    url.searchParams.set("template", "markdown");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));

      return {
        ok: response.ok,
        statusCode: response.status,
        payload
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  PushPlusNotifier
};
