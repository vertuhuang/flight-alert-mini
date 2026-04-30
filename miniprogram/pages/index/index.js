const { request } = require("../../utils/request");
const { formatDateTime, formatMonthDayTime, joinDates } = require("../../utils/format");
const { getCityByCode } = require("../../utils/airports");

Page({
  data: {
    loading: false,
    tasks: [],
    healthText: "",
    showActionSheet: false,
    showDeleteDialog: false,
    selectedTaskId: "",
    selectedTask: null,
    actionItems: []
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

      const tasks = (tasksRes.items || []).map((task) => {
        // 构建最新变价信息
        let latestChangeInfo = null;
        if (task.latestChange) {
          latestChangeInfo = {
            timeStr: formatMonthDayTime(task.latestChange.checkedAt),
            type: task.latestChange.type, // "drop" 或 "rise"
            delta: Math.abs(task.latestChange.delta)
          };
        }
        // 获取当前价格：优先从 latestSummary，其次从历史记录
        let currentPrice = task.latestSummary?.minPrice;
        if (currentPrice == null && task.latestChange?.currentPrice != null) {
          currentPrice = task.latestChange.currentPrice;
        }
        return {
          ...task,
          currentPrice,
          routeText: `${getCityByCode(task.placeFrom) || task.placeFrom} → ${getCityByCode(task.placeTo) || task.placeTo}`,
          departDatesText: joinDates(task.departDates),
          latestChangeInfo,
          lastCheckedText: formatDateTime(task.lastCheckedAt),
          nextCheckText: formatDateTime(task.nextCheckAt)
        };
      });

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
  },

  onLongPress(event) {
    // 阻止事件冒泡，防止触发 bindtap
    if (event.stopPropagation) {
      event.stopPropagation();
    }
    const { id } = event.currentTarget.dataset;
    const task = this.data.tasks.find((t) => t.id === id);
    if (!task) return;

    const actionItems = [
      { label: "查看详情" },
      { label: "重新获取价格" },
      { label: task.active ? "暂停监控" : "启用监控" },
      { label: "删除任务" }
    ];

    this.setData({
      showActionSheet: true,
      selectedTaskId: id,
      selectedTask: task,
      actionItems
    });
  },

  onActionSheetClose() {
    this.setData({ showActionSheet: false });
  },

  onActionSheetSelect(event) {
    const index = event.detail.index;
    this.setData({ showActionSheet: false });

    switch (index) {
      case 0:
        this.openTaskDetail({ currentTarget: { dataset: { id: this.data.selectedTaskId } } });
        break;
      case 1:
        this.checkNow(this.data.selectedTaskId);
        break;
      case 2:
        this.toggleActive(this.data.selectedTaskId, this.data.selectedTask);
        break;
      case 3:
        this.setData({ showDeleteDialog: true });
        break;
    }
  },

  async checkNow(taskId) {
    wx.showLoading({ title: "检查中" });
    try {
      await request({
        url: `/tasks/${taskId}/check-now`,
        method: "POST"
      });
      wx.showToast({ title: "检查完成", icon: "success" });
      this.loadData();
    } catch (error) {
      wx.showToast({
        title: error.message || "检查失败",
        icon: "none"
      });
    } finally {
      wx.hideLoading();
    }
  },

  async toggleActive(taskId, task) {
    const nextActive = !task.active;
    try {
      await request({
        url: `/tasks/${taskId}`,
        method: "PATCH",
        data: { active: nextActive }
      });
      wx.showToast({
        title: nextActive ? "已启用" : "已暂停",
        icon: "success"
      });
      this.loadData();
    } catch (error) {
      wx.showToast({
        title: error.message || "更新失败",
        icon: "none"
      });
    }
  },

  onCloseDeleteDialog() {
    this.setData({ showDeleteDialog: false });
  },

  async doDelete() {
    this.setData({ showDeleteDialog: false });
    try {
      await request({
        url: `/tasks/${this.data.selectedTaskId}`,
        method: "DELETE"
      });
      wx.showToast({ title: "已删除", icon: "success" });
      this.loadData();
    } catch (error) {
      wx.showToast({
        title: error.message || "删除失败",
        icon: "none"
      });
    }
  }
});
