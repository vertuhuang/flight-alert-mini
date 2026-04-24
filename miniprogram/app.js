App({
  async onLaunch() {
    const { runtimeMode, cloudEnv } = this.globalData;

    if (runtimeMode !== "cloud") {
      return;
    }

    if (!wx.cloud) {
      console.warn("当前基础库不可用 wx.cloud，请检查微信开发者工具配置。");
      return;
    }

    await wx.cloud.init({
      env: cloudEnv || undefined,
      traceUser: true
    });
  },

  globalData: {
    // "cloud" 使用 wx.cloud.callContainer，"local" 使用 wx.request 直连本地服务。
    runtimeMode: "cloud",
    cloudEnv: "cloud1-d3gu5h3dk5e16d52b",
    cloudService: "flight-alert-api",
    apiBaseUrl: "http://127.0.0.1:8787/api"
  }
});
