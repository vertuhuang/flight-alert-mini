const { request } = require("../../utils/request");
const { joinDates, formatDateTime } = require("../../utils/format");

Page({
  data: {
    loading: false,
    tasks: [],
    healthText: ""
  },

  onShow() {
    this.loadData();
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
        departDatesText: joinDates(task.departDates),
        returnDatesText: joinDates(task.returnDates),
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

  openTaskDetail(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/task-detail/task-detail?id=${id}`
    });
  }
});
