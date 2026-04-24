const { request } = require("../../utils/request");
const { formatDateTime, joinDates } = require("../../utils/format");

Page({
  data: {
    id: "",
    loading: false,
    checking: false,
    task: null,
    history: []
  },

  onLoad(query) {
    this.setData({ id: query.id || "" });
  },

  onShow() {
    this.loadDetail();
  },

  async loadDetail() {
    if (!this.data.id) {
      return;
    }

    this.setData({ loading: true });
    try {
      const [task, historyRes] = await Promise.all([
        request({ url: `/tasks/${this.data.id}` }),
        request({ url: `/tasks/${this.data.id}/history` })
      ]);

      const history = (historyRes.items || []).map((item) => ({
        ...item,
        checkedAtText: formatDateTime(item.checkedAt),
        changes: (item.changes || []).map((change) => ({
          ...change,
          deltaAbs: change.delta == null ? "" : Math.abs(change.delta)
        }))
      }));

      this.setData({
        task: {
          ...task,
          departDatesText: joinDates(task.departDates),
          returnDatesText: joinDates(task.returnDates),
          lastCheckedText: formatDateTime(task.lastCheckedAt),
          nextCheckText: formatDateTime(task.nextCheckAt)
        },
        history
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

  async checkNow() {
    if (this.data.checking) {
      return;
    }

    this.setData({ checking: true });
    try {
      await request({
        url: `/tasks/${this.data.id}/check-now`,
        method: "POST"
      });
      wx.showToast({
        title: "检查完成",
        icon: "success"
      });
      await this.loadDetail();
    } catch (error) {
      wx.showToast({
        title: error.message || "检查失败",
        icon: "none"
      });
    } finally {
      this.setData({ checking: false });
    }
  },

  async toggleActive() {
    if (!this.data.task) {
      return;
    }

    const nextActive = !this.data.task.active;
    try {
      await request({
        url: `/tasks/${this.data.id}`,
        method: "PATCH",
        data: {
          active: nextActive
        }
      });
      wx.showToast({
        title: nextActive ? "已启用" : "已暂停",
        icon: "success"
      });
      await this.loadDetail();
    } catch (error) {
      wx.showToast({
        title: error.message || "更新失败",
        icon: "none"
      });
    }
  }
});
