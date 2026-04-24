const { request } = require("../../utils/request");

const FLIGHT_WAYS = ["Oneway", "Roundtrip"];

Page({
  data: {
    flightWays: FLIGHT_WAYS,
    flightWayIndex: 0,
    form: {
      name: "",
      placeFrom: "",
      placeTo: "",
      departDates: "",
      returnDates: "",
      threshold: "50",
      checkIntervalSec: "600",
      pushplusToken: "",
      active: true
    },
    submitting: false
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [`form.${field}`]: event.detail.value
    });
  },

  onFlightWayChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      flightWayIndex: index
    });
  },

  onActiveChange(event) {
    this.setData({
      "form.active": event.detail.value
    });
  },

  async submit() {
    if (this.data.submitting) {
      return;
    }

    const payload = {
      ...this.data.form,
      flightWay: FLIGHT_WAYS[this.data.flightWayIndex],
      placeFrom: this.data.form.placeFrom.toUpperCase(),
      placeTo: this.data.form.placeTo.toUpperCase(),
      departDates: this.data.form.departDates,
      returnDates: this.data.form.returnDates
    };

    this.setData({ submitting: true });
    try {
      await request({
        url: "/tasks",
        method: "POST",
        data: payload
      });

      wx.showToast({
        title: "创建成功",
        icon: "success"
      });

      setTimeout(() => {
        wx.navigateBack();
      }, 500);
    } catch (error) {
      wx.showToast({
        title: error.message || "创建失败",
        icon: "none"
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
