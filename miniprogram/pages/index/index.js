const { request } = require("../../utils/request");
const { formatDateTime, joinDates } = require("../../utils/format");
const { getCityByCode } = require("../../utils/airports");

Page({
  data: {
    loading: false,
    tasks: [],
    healthText: ""
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().then(() => wx.stopPullDownRefresh());
  },

  async loadData() {
    this.setData({ loading: true });

    try {
      const [health, tasksRes] = await Promise.all([
        request({ url: "/health" }),
        request({ url: "/tasks" })
      ]);

      const tasks = (tasksRes.items || []).map((task) => ({
        ...task,
        routeText: `${getCityByCode(task.placeFrom) || task.placeFrom} → ${getCityByCode(task.placeTo) || task.placeTo}`,
        departDatesText: joinDates(task.departDates),
        lastPriceChangeText: formatDateTime(task.lastPriceChangeAt),
        lastCheckedText: formatDateTime(task.lastCheckedAt),
        nextCheckText: formatDateTime(task.nextCheckAt)
      }));

      this.setData({
        tasks,
        healthText: `服务在线 ${formatDateTime(health.now)}`
      });
    } catch (error) {
      wx.showToast({
        title: error.message || "加载失败",
        icon: "none"
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  goCreateTask() {
    wx.navigateTo({
      url: "/pages/task-form/task-form"
    });
  },

  goEvents() {
    wx.navigateTo({
      url: "/pages/events/events"
    });
  },

  openTaskDetail(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/task-detail/task-detail?id=${id}`
    });
  }
});
