function normalizeApiPath(url) {
  if (url.startsWith("/api/")) {
    return url;
  }

  return `/api${url}`;
}

function handleResponse(resolve, reject, res) {
  const statusCode = res.statusCode || 200;
  const responseData = res.data == null ? res : res.data;

  if (statusCode >= 200 && statusCode < 300) {
    resolve(responseData);
    return;
  }

  reject(new Error(responseData?.message || "请求失败"));
}

function request({ url, method = "GET", data, header = {} }) {
  return new Promise((resolve, reject) => {
    const app = getApp();
    const { runtimeMode, apiBaseUrl, cloudEnv, cloudService } = app.globalData;
    const apiPath = normalizeApiPath(url);

    if (runtimeMode === "cloud") {
      if (!wx.cloud) {
        reject(new Error("当前环境未启用 wx.cloud"));
        return;
      }

      if (!cloudService) {
        reject(new Error("请先在 app.js 中配置云托管服务名"));
        return;
      }

      const callOptions = {
        path: apiPath,
        method,
        header: {
          "X-WX-SERVICE": cloudService,
          ...header
        },
        data
      };

      if (cloudEnv) {
        callOptions.config = {
          env: cloudEnv
        };
      }

      wx.cloud
        .callContainer(callOptions)
        .then((res) => handleResponse(resolve, reject, res))
        .catch((error) => reject(error));
      return;
    }

    wx.request({
      url: `${apiBaseUrl}${url}`,
      method,
      data,
      header,
      timeout: 15000,
      success(res) {
        handleResponse(resolve, reject, res);
      },
      fail(error) {
        reject(error);
      }
    });
  });
}

module.exports = {
  request
};
