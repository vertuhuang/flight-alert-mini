const { request } = require("../../utils/request");
const { formatDateTime } = require("../../utils/format");
const { getCityByCode } = require("../../utils/airports");

Page({
  data: {
    events: []
  },

  onShow() {
    this.loadEvents();
  },

  onPullDownRefresh() {
    this.loadEvents().then(() => wx.stopPullDownRefresh());
  },

  async loadEvents() {
    try {
      const res = await request({ url: "/events" });
      const events = (res.items || []).map((event) => ({
        ...event,
        createdAtText: formatDateTime(event.createdAt),
        changes: (event.changes || []).map((change) => ({
          ...change,
          deltaAbs: change.delta == null ? "" : Math.abs(change.delta)
        }))
      }));

      this.setData({ events });
    } catch (error) {
      wx.showToast({
        title: error.message || "加载失败",
        icon: "none"
      });
    }
  }
});
