const { request } = require("../../utils/request");
const { formatDateTime, joinDates, joinDatesShort } = require("../../utils/format");
const { getCityByCode } = require("../../utils/airports");

Page({
  data: {
    id: "",
    loading: false,
    checking: false,
    task: null,
    history: [],
    showDeleteDialog: false,
    showActionSheet: false,
    actionItems: []
  },

  onLoad(query) {
    this.setData({ id: query.id || "" });
  },

  onShow() {
    this.loadDetail();
  },

  async loadDetail() {
    if (!this.data.id) return;

    this.setData({ loading: true });
    try {
      const [task, historyRes] = await Promise.all([
        request({ url: `/tasks/${this.data.id}` }),
        request({ url: `/tasks/${this.data.id}/history` })
      ]);

      // Clear unread
      if (task.unreadEvents) {
        request({
          url: `/tasks/${this.data.id}/clear-unread`,
          method: "POST"
        }).catch(() => {});
      }

      const history = (historyRes.items || []).map((item) => ({
        ...item,
        checkedAtText: formatDateTime(item.checkedAt),
        changes: (item.changes || []).map((change) => ({
          ...change,
          deltaAbs: change.delta == null ? "" : Math.abs(change.delta)
        }))
      }));

      const fromCity = getCityByCode(task.placeFrom) || task.placeFrom;
      const toCity = getCityByCode(task.placeTo) || task.placeTo;
      const datesShort = joinDatesShort(task.departDates);

      const actionItems = [
        { label: "重新获取价格" },
        { label: "编辑" },
        { label: task.active ? "暂停" : "启用" },
        { label: "删除任务" }
      ];

      this.setData({
        task: {
          ...task,
          placeFromText: fromCity,
          placeToText: toCity,
          headerTitle: `${fromCity} → ${toCity}（${datesShort}）`,
          departDatesText: joinDates(task.departDates),
          returnDatesText: joinDates(task.returnDates),
          lastCheckedText: formatDateTime(task.lastCheckedAt),
          nextCheckText: formatDateTime(task.nextCheckAt)
        },
        history,
        actionItems
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
    if (this.data.checking) return;

    this.setData({ checking: true });
    try {
      await request({
        url: `/tasks/${this.data.id}/check-now`,
        method: "POST"
      });
      wx.showToast({ title: "检查完成", icon: "success" });
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
    if (!this.data.task) return;

    const nextActive = !this.data.task.active;
    try {
      await request({
        url: `/tasks/${this.data.id}`,
        method: "PATCH",
        data: { active: nextActive }
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
  },

  goEdit() {
    wx.navigateTo({
      url: `/pages/task-form/task-form?id=${this.data.id}`
    });
  },

  onOpenActionSheet() {
    this.setData({ showActionSheet: true });
  },

  onActionSheetClose() {
    this.setData({ showActionSheet: false });
  },

  onActionSheetSelect(e) {
    const index = e.detail.index;
    this.setData({ showActionSheet: false });
    switch (index) {
      case 0:
        this.checkNow();
        break;
      case 1:
        this.goEdit();
        break;
      case 2:
        this.toggleActive();
        break;
      case 3:
        this.confirmDelete();
        break;
    }
  },

  confirmDelete() {
    this.setData({ showDeleteDialog: true });
  },

  async doDelete() {
    this.setData({ showDeleteDialog: false });
    try {
      await request({
        url: `/tasks/${this.data.id}`,
        method: "DELETE"
      });
      wx.showToast({ title: "已删除", icon: "success" });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      wx.showToast({
        title: error.message || "删除失败",
        icon: "none"
      });
    }
  }
});
