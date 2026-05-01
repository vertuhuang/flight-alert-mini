const { request } = require("../../utils/request");
const { formatDateTime, joinDates, joinDatesShort } = require("../../utils/format");
const { getCityByCode } = require("../../utils/airports");
const { requestSubscribe, markSubscribed, SUBSCRIBE_TEMPLATE_ID } = require("../../utils/subscribe");

Page({
  data: {
    id: "",
    loading: false,
    checking: false,
    task: null,
    history: [],
    showDeleteDialog: false,
    showActionSheet: false,
    actionItems: [],
    subscribeCount: 0
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

        // 查看通知后，如果任务开启了订阅消息，提示用户重新订阅
        if (task.subscribeEnabled && SUBSCRIBE_TEMPLATE_ID) {
          this.promptResubscribe();
        }
      }

      const sortedHistory = (historyRes.items || [])
        .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime());

      const history = sortedHistory
        .map((item, index) => {
          const previousItem = sortedHistory[index + 1] || null;
          const currentMinPrice = item.summary?.minPrice;
          const previousMinPrice = previousItem?.summary?.minPrice;
          let changes = [];

          if (
            currentMinPrice != null &&
            previousMinPrice != null &&
            currentMinPrice !== previousMinPrice
          ) {
            const delta = currentMinPrice - previousMinPrice;
            changes = [{
              type: delta > 0 ? "rise" : "drop",
              delta,
              deltaAbs: Math.abs(delta),
              current: currentMinPrice,
              previous: previousMinPrice
            }];
          }

          return {
            ...item,
            checkedAtText: formatDateTime(item.checkedAt),
            changes
          };
        })
        .filter((item) => item.changes.length > 0);

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
        actionItems,
        subscribeCount: task.subscribeQuota || 0
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
  },

  /**
   * 提示用户重新订阅消息
   * 订阅消息为一次性消费，发送一条后需要用户重新授权
   */
  async promptResubscribe() {
    try {
      const res = await requestSubscribe();
      // 检查是否有模板授权成功
      if (res && SUBSCRIBE_TEMPLATE_ID && res[SUBSCRIBE_TEMPLATE_ID] === "accept") {
        markSubscribed(this.data.id);
        // 调用后端 API 增加配额
        const result = await request({
          url: `/tasks/${this.data.id}/subscribe-quota`,
          method: "POST",
          data: { amount: 1 }
        });
        // 更新显示的配额
        if (result && result.subscribeQuota !== undefined) {
          this.setData({ subscribeCount: result.subscribeQuota });
        }
        wx.showToast({ title: "订阅成功", icon: "success" });
      }
    } catch (err) {
      // 用户拒绝或不支持，不影响主流程
      console.log("重新订阅提示:", err);
    }
  },

  /**
   * 用户主动点击重新订阅按钮
   */
  async onResubscribe() {
    await this.promptResubscribe();
  }
});
