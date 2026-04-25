const { request } = require("../../utils/request");

const FLIGHT_WAYS = ["Oneway", "Roundtrip"];
const FLIGHT_WAY_LABELS = ["单程", "往返"];

Page({
  data: {
    isEdit: false,
    taskId: "",
    flightWayLabels: FLIGHT_WAY_LABELS,
    flightWayIndex: 0,
    flightWayOptions: [FLIGHT_WAY_LABELS],
    form: {
      name: "",
      placeFrom: "",
      placeTo: "",
      departDates: "",
      returnDates: "",
      threshold: "50",
      targetPrice: "",
      notifyOnDrop: true,
      checkIntervalSec: "600",
      pushplusToken: "",
      active: true
    },
    submitting: false
  },

  onLoad(query) {
    if (query.id) {
      this.setData({ isEdit: true, taskId: query.id });
      this.loadTask(query.id);
    }
  },

  async loadTask(id) {
    try {
      const task = await request({ url: `/tasks/${id}` });
      const flightWayIndex = task.flightWay === "Roundtrip" ? 1 : 0;
      this.setData({
        flightWayIndex,
        form: {
          name: task.name || "",
          placeFrom: task.placeFrom || "",
          placeTo: task.placeTo || "",
          departDates: (task.departDates || []).join(","),
          returnDates: (task.returnDates || []).join(","),
          threshold: String(task.threshold || 50),
          targetPrice: task.targetPrice ? String(task.targetPrice) : "",
          notifyOnDrop: task.notifyOnDrop !== false,
          checkIntervalSec: String(task.checkIntervalSec || 600),
          pushplusToken: task.pushplusToken || "",
          active: task.active !== false
        }
      });
    } catch (error) {
      wx.showToast({ title: "加载任务失败", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1000);
    }
  },

  onInputChange(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({
      [`form.${field}`]: event.detail.value
    });
  },

  onFromChange(e) {
    this.setData({ "form.placeFrom": e.detail.code });
  },

  onToChange(e) {
    this.setData({ "form.placeTo": e.detail.code });
  },

  onFlightWayConfirm(event) {
    const index = event.detail.value[0];
    this.setData({ flightWayIndex: index });
  },

  onNotifyDropChange(event) {
    this.setData({ "form.notifyOnDrop": event.detail.value });
  },

  onActiveChange(event) {
    this.setData({ "form.active": event.detail.value });
  },

  async submit() {
    if (this.data.submitting) return;

    const { form, flightWayIndex, isEdit, taskId } = this.data;

    if (!form.placeFrom) {
      wx.showToast({ title: "请选择出发城市", icon: "none" });
      return;
    }
    if (!form.placeTo) {
      wx.showToast({ title: "请选择到达城市", icon: "none" });
      return;
    }

    const payload = {
      ...form,
      flightWay: FLIGHT_WAYS[flightWayIndex],
      placeFrom: form.placeFrom.toUpperCase(),
      placeTo: form.placeTo.toUpperCase(),
      targetPrice: form.targetPrice ? Number(form.targetPrice) : null
    };

    this.setData({ submitting: true });
    try {
      if (isEdit) {
        await request({
          url: `/tasks/${taskId}`,
          method: "PATCH",
          data: payload
        });
        wx.showToast({ title: "更新成功", icon: "success" });
      } else {
        await request({
          url: "/tasks",
          method: "POST",
          data: payload
        });
        wx.showToast({ title: "创建成功", icon: "success" });
      }
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      wx.showToast({
        title: error.message || (isEdit ? "更新失败" : "创建失败"),
        icon: "none"
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
