const { request } = require("../../utils/request");
const { formatDateTime, formatMonthDayTime, joinDates } = require("../../utils/format");
const { getCityByCode } = require("../../utils/airports");
const { getCurrencyName } = require("../../utils/currencies");

Page({
  data: {
    loading: false,
    tasks: [],
    healthText: "",
    showActionSheet: false,
    showCreateSheet: false,
    createTypeItems: [
      { label: "机票价格监控" },
      { label: "汇率监控" }
    ],
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

      // 计算今天日期字符串 YYYYMMDD
      const now = new Date();
      const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

      const tasks = (tasksRes.items || []).map((task) => {
        // 判断是否过期
        let isExpired = false;
        if (task.monitorType !== "exchange_rate" && task.departDates && task.departDates.length) {
          const maxDepartDate = Math.max(...task.departDates.map(d => Number(d)));
          isExpired = maxDepartDate < Number(todayStr);
        }
        // 构建最新变价信息
        let latestChangeInfo = null;
        if (task.latestChange) {
          latestChangeInfo = {
            timeStr: formatMonthDayTime(task.latestChange.checkedAt),
            type: task.latestChange.type, // "drop" 或 "rise"
            delta: Math.abs(task.latestChange.delta)
          };
        }
        // 获取当前价格/汇率
        let currentPrice = task.latestSummary?.minPrice;
        if (currentPrice == null && task.latestChange?.currentPrice != null) {
          currentPrice = task.latestChange.currentPrice;
        }
        // 预格式化显示文本（WXML 不支持方法调用）
        const priceText = currentPrice != null
          ? (task.monitorType === "exchange_rate" ? currentPrice.toFixed(4) : String(currentPrice))
          : null;
        const deltaText = latestChangeInfo
          ? (task.monitorType === "exchange_rate" ? latestChangeInfo.delta.toFixed(4) : latestChangeInfo.delta + "元")
          : null;
        // 构建路线/货币对文本
        let routeText;
        if (task.monitorType === "exchange_rate") {
          routeText = `${getCurrencyName(task.baseCurrency)} / ${getCurrencyName(task.quoteCurrency)}`;
        } else {
          routeText = `${getCityByCode(task.placeFrom) || task.placeFrom} / ${getCityByCode(task.placeTo) || task.placeTo}`;
        }
        return {
          ...task,
          isExpired,
          currentPrice,
          priceText,
          deltaText,
          routeText,
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
    // 弹出监控类型选择浮层
    this.setData({ showCreateSheet: true });
  },

  onCreateTypeSelect(event) {
    const index = event.detail.index;
    this.setData({ showCreateSheet: false });
    const params = index === 1 ? "?monitorType=exchange_rate" : "";
    wx.navigateTo({
      url: `/pages/task-form/task-form${params}`
    });
  },

  onCreateTypeClose() {
    this.setData({ showCreateSheet: false });
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

  goEdit(taskId) {
    wx.navigateTo({
      url: `/pages/task-form/task-form?id=${taskId}`
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

    let actionItems;
    if (task.isExpired) {
      // 已过期任务：删除当前任务、删除所有过期任务
      actionItems = [
        { label: "删除当前任务" },
        { label: "删除所有过期任务" }
      ];
    } else {
      // 未过期任务：与详情页"更多"相同
      actionItems = [
        { label: "重新获取价格" },
        { label: "编辑" },
        { label: task.active ? "暂停" : "启用" },
        { label: "删除任务" }
      ];
    }

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

  onActionSheetVisibleChange(e) {
    // 点击遮罩或关闭按钮时，visible 变为 false
    if (!e.detail.visible) {
      this.setData({ showActionSheet: false });
    }
  },

  confirmDelete() {
    this.setData({ showDeleteDialog: true });
  },

  onActionSheetSelect(event) {
    const index = event.detail.index;
    this.setData({ showActionSheet: false });

    const task = this.data.selectedTask;
    if (!task) return;

    if (task.isExpired) {
      // 已过期任务：0=删除当前任务, 1=删除所有过期任务
      switch (index) {
        case 0:
          this.confirmDelete();
          break;
        case 1:
          this.confirmDeleteAllExpired();
          break;
      }
    } else {
      // 未过期任务：0=重新获取价格, 1=编辑, 2=暂停/启用, 3=删除任务
      switch (index) {
        case 0:
          this.checkNow(this.data.selectedTaskId);
          break;
        case 1:
          this.goEdit(this.data.selectedTaskId);
          break;
        case 2:
          this.toggleActive(this.data.selectedTaskId, this.data.selectedTask);
          break;
        case 3:
          this.confirmDelete();
          break;
      }
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
    // 已过期任务不允许启用
    if (!task.active && task.isExpired) {
      wx.showToast({
        title: "任务已过期，无法启用",
        icon: "none"
      });
      return;
    }
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
  },

  confirmDeleteAllExpired() {
    const expiredCount = this.data.tasks.filter(t => t.isExpired).length;
    if (expiredCount === 0) {
      wx.showToast({ title: "没有过期任务", icon: "none" });
      return;
    }
    wx.showModal({
      title: "确认删除",
      content: `确定要删除所有过期任务吗？共 ${expiredCount} 个任务，此操作不可恢复。`,
      confirmText: "删除",
      confirmColor: "#dc2626",
      success: (res) => {
        if (res.confirm) {
          this.deleteAllExpiredTasks();
        }
      }
    });
  },

  async deleteAllExpiredTasks() {
    const expiredTasks = this.data.tasks.filter(t => t.isExpired);
    if (!expiredTasks.length) {
      wx.showToast({ title: "没有过期任务", icon: "none" });
      return;
    }

    wx.showLoading({ title: `正在删除${expiredTasks.length}个任务...` });
    let successCount = 0;
    let failCount = 0;

    for (const task of expiredTasks) {
      try {
        await request({
          url: `/tasks/${task.id}`,
          method: "DELETE"
        });
        successCount++;
      } catch (error) {
        failCount++;
        console.error(`删除任务 ${task.id} 失败:`, error);
      }
    }

    wx.hideLoading();
    if (failCount === 0) {
      wx.showToast({ title: `已删除${successCount}个任务`, icon: "success" });
    } else {
      wx.showToast({ title: `删除完成，${successCount}成功${failCount}失败`, icon: "none" });
    }
    this.loadData();
  }
});
