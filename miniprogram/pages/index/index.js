const { request } = require("../../utils/request");
const { formatDateTime, formatMonthDayTime, joinDates } = require("../../utils/format");
const { getCityByCode } = require("../../utils/airports");
const { getCurrencyName } = require("../../utils/currencies");
const {
  DEFAULT_SILENT_END,
  DEFAULT_SILENT_START,
  formatSilentRange,
  getUserSettings,
  normalizeTimeText,
  saveUserSettings
} = require("../../utils/user-settings");

const SETTINGS_ITEMS = [
  { label: "PushPlus Token 设置" },
  { label: "静默时段设置" }
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => ({
  label: String(index).padStart(2, "0"),
  value: String(index).padStart(2, "0")
}));

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => ({
  label: String(index).padStart(2, "0"),
  value: String(index).padStart(2, "0")
}));

function splitTimeValue(value, fallback) {
  const normalized = normalizeTimeText(value, fallback);
  return normalized.split(":");
}

Page({
  data: {
    loading: false,
    tasks: [],
    healthText: "",
    showActionSheet: false,
    showCreateSheet: false,
    showSettingsSheet: false,
    showDeleteDialog: false,
    showPushplusPopup: false,
    showSilentPopup: false,
    showTimePicker: false,
    createTypeItems: [
      { label: "机票价格监控" },
      { label: "汇率监控" }
    ],
    settingsItems: SETTINGS_ITEMS,
    selectedTaskId: "",
    selectedTask: null,
    actionItems: [],
    userSettings: null,
    pushplusTokenInput: "",
    savingUserSettings: false,
    silentRangeText: `${DEFAULT_SILENT_START} - ${DEFAULT_SILENT_END}`,
    silentDraftStart: DEFAULT_SILENT_START,
    silentDraftEnd: DEFAULT_SILENT_END,
    editingSilentField: "start",
    timePickerTitle: "选择开始时间",
    timePickerValue: splitTimeValue(DEFAULT_SILENT_START, DEFAULT_SILENT_START),
    timePickerOptions: [HOUR_OPTIONS, MINUTE_OPTIONS]
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
      const [health, tasksRes, userSettings] = await Promise.all([
        request({ url: "/health" }),
        request({ url: "/tasks" }),
        getUserSettings().catch(() => null)
      ]);

      const now = new Date();
      const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

      const tasks = (tasksRes.items || []).map((task) => {
        let isExpired = false;
        if (task.monitorType !== "exchange_rate" && task.departDates && task.departDates.length) {
          const maxDepartDate = Math.max(...task.departDates.map((d) => Number(d)));
          isExpired = maxDepartDate < Number(todayStr);
        }

        let latestChangeInfo = null;
        if (task.latestChange) {
          latestChangeInfo = {
            timeStr: formatMonthDayTime(task.latestChange.checkedAt),
            type: task.latestChange.type,
            delta: Math.abs(task.latestChange.delta)
          };
        }

        let currentPrice = task.latestSummary?.minPrice;
        if (currentPrice == null && task.latestChange?.currentPrice != null) {
          currentPrice = task.latestChange.currentPrice;
        }

        const priceText = currentPrice != null
          ? (task.monitorType === "exchange_rate" ? currentPrice.toFixed(4) : String(currentPrice))
          : null;
        const deltaText = latestChangeInfo
          ? (task.monitorType === "exchange_rate" ? latestChangeInfo.delta.toFixed(4) : `${latestChangeInfo.delta}元`)
          : null;
        const routeText = task.monitorType === "exchange_rate"
          ? `${getCurrencyName(task.baseCurrency)} / ${getCurrencyName(task.quoteCurrency)}`
          : `${getCityByCode(task.placeFrom) || task.placeFrom} / ${getCityByCode(task.placeTo) || task.placeTo}`;

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

      const nextUserSettings = userSettings || {
        pushplusToken: "",
        silentStart: DEFAULT_SILENT_START,
        silentEnd: DEFAULT_SILENT_END
      };

      this.setData({
        tasks,
        healthText: `服务在线 ${formatDateTime(health.now)}`,
        userSettings: nextUserSettings,
        pushplusTokenInput: nextUserSettings.pushplusToken || "",
        silentRangeText: formatSilentRange(nextUserSettings),
        silentDraftStart: nextUserSettings.silentStart,
        silentDraftEnd: nextUserSettings.silentEnd
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

  openSettings() {
    this.setData({ showSettingsSheet: true });
  },

  onSettingsClose() {
    this.setData({ showSettingsSheet: false });
  },

  onSettingsSelect(event) {
    const index = event.detail.index;
    this.setData({ showSettingsSheet: false });
    if (index === 0) {
      this.openPushplusSettings();
      return;
    }
    if (index === 1) {
      this.openSilentSettings();
    }
  },

  openPushplusSettings() {
    const token = this.data.userSettings?.pushplusToken || wx.getStorageSync("pushplus_token") || "";
    this.setData({
      showPushplusPopup: true,
      pushplusTokenInput: token
    });
  },

  closePushplusPopup() {
    this.setData({ showPushplusPopup: false });
  },

  onPushplusInputChange(event) {
    this.setData({ pushplusTokenInput: event.detail.value });
  },

  async savePushplusToken() {
    const token = String(this.data.pushplusTokenInput || "").trim();
    if (!token) {
      wx.showToast({ title: "请输入 PushPlus Token", icon: "none" });
      return;
    }

    this.setData({ savingUserSettings: true });
    try {
      const user = await saveUserSettings({
        pushplusToken: token
      });
      wx.setStorageSync("pushplus_token", token);
      this.setData({
        userSettings: user,
        showPushplusPopup: false,
        silentRangeText: formatSilentRange(user)
      });
      wx.showToast({ title: "保存成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ savingUserSettings: false });
    }
  },

  openSilentSettings() {
    const userSettings = this.data.userSettings || {
      silentStart: DEFAULT_SILENT_START,
      silentEnd: DEFAULT_SILENT_END
    };
    this.setData({
      showSilentPopup: true,
      silentDraftStart: userSettings.silentStart,
      silentDraftEnd: userSettings.silentEnd
    });
  },

  closeSilentPopup() {
    this.setData({ showSilentPopup: false, showTimePicker: false });
  },

  openSilentPicker(event) {
    const field = event.currentTarget.dataset.field || "start";
    const value = field === "start" ? this.data.silentDraftStart : this.data.silentDraftEnd;
    this.setData({
      showTimePicker: true,
      editingSilentField: field,
      timePickerTitle: field === "start" ? "选择开始时间" : "选择结束时间",
      timePickerValue: splitTimeValue(value, field === "start" ? DEFAULT_SILENT_START : DEFAULT_SILENT_END)
    });
  },

  onSilentPickerConfirm(event) {
    const [hour, minute] = event.detail.value;
    const value = `${hour}:${minute}`;
    const field = this.data.editingSilentField;
    this.setData({
      showTimePicker: false,
      [field === "start" ? "silentDraftStart" : "silentDraftEnd"]: value
    });
  },

  onSilentPickerCancel() {
    this.setData({ showTimePicker: false });
  },

  async saveSilentSettings() {
    this.setData({ savingUserSettings: true });
    try {
      const user = await saveUserSettings({
        silentStart: this.data.silentDraftStart,
        silentEnd: this.data.silentDraftEnd
      });
      this.setData({
        userSettings: user,
        silentRangeText: formatSilentRange(user),
        showSilentPopup: false
      });
      wx.showToast({ title: "保存成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ savingUserSettings: false, showTimePicker: false });
    }
  },

  goCreateTask() {
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
    if (event.stopPropagation) {
      event.stopPropagation();
    }
    const { id } = event.currentTarget.dataset;
    const task = this.data.tasks.find((item) => item.id === id);
    if (!task) return;

    const actionItems = task.isExpired
      ? [
          { label: "删除当前任务" },
          { label: "删除所有过期任务" }
        ]
      : [
          { label: "重新获取价格" },
          { label: "编辑" },
          { label: task.active ? "暂停" : "启用" },
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

  onActionSheetVisibleChange(e) {
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
      switch (index) {
        case 0:
          this.confirmDelete();
          break;
        case 1:
          this.confirmDeleteAllExpired();
          break;
      }
      return;
    }

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
    const expiredCount = this.data.tasks.filter((task) => task.isExpired).length;
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
    const expiredTasks = this.data.tasks.filter((task) => task.isExpired);
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
