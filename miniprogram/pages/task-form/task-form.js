const { request } = require("../../utils/request");
const { getCityByCode, AIRPORTS } = require("../../utils/airports");
const { formatDateShort } = require("../../utils/format");

const FLIGHT_WAYS = ["Oneway", "Roundtrip"];
const FLIGHT_WAY_LABELS = ["单程", "往返"];

const AIRPORT_OPTIONS = AIRPORTS.map((a) => ({ label: `${a.city} (${a.code})`, value: a.code }));

function generateTaskName(form, flightWayIndex) {
  const departDate = form.departDates || "";
  const fromCity = getCityByCode(form.placeFrom) || form.placeFrom;
  const toCity = getCityByCode(form.placeTo) || form.placeTo;

  if (!departDate || !fromCity || !toCity) return "";

  const m = departDate.slice(4, 6).replace(/^0/, "");
  const d = departDate.slice(6, 8).replace(/^0/, "");
  const isRound = FLIGHT_WAYS[flightWayIndex || 0] === "Roundtrip";
  return `${m}月${d}日${fromCity}飞${toCity}${isRound ? "往返" : ""}`;
}

Page({
  data: {
    isEdit: false,
    taskId: "",
    flightWayLabels: FLIGHT_WAY_LABELS,
    flightWayIndex: 0,
    flightWayOptions: [FLIGHT_WAY_LABELS],
    airportOptions: AIRPORT_OPTIONS,
    form: {
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
    placeFromText: "",
    placeToText: "",
    fromPickerIndex: 0,
    toPickerIndex: 0,
    showFromPicker: false,
    showToPicker: false,
    showFlightWayPicker: false,
    departDateLabel: "",
    departDateValue: "",
    returnDateLabel: "",
    returnDateValue: "",
    showDepartDatePicker: false,
    showReturnDatePicker: false,
    submitting: false
  },

  onLoad(query) {
    if (query.id) {
      this.setData({ isEdit: true, taskId: query.id });
      this.loadTask(query.id);
    } else {
      const savedToken = wx.getStorageSync("pushplus_token");
      if (savedToken) {
        this.setData({ "form.pushplusToken": savedToken });
      }
    }
  },

  async loadTask(id) {
    try {
      const task = await request({ url: `/tasks/${id}` });
      const flightWayIndex = task.flightWay === "Roundtrip" ? 1 : 0;
      const departDates = task.departDates || [];
      const returnDates = task.returnDates || [];
      const departDate = Array.isArray(departDates) ? departDates[0] || "" : departDates;
      const returnDate = Array.isArray(returnDates) ? returnDates[0] || "" : returnDates;
      const fromIndex = AIRPORT_OPTIONS.findIndex((o) => o.value === task.placeFrom);
      const toIndex = AIRPORT_OPTIONS.findIndex((o) => o.value === task.placeTo);

      this.setData({
        flightWayIndex,
        form: {
          placeFrom: task.placeFrom || "",
          placeTo: task.placeTo || "",
          departDates: departDate,
          returnDates: returnDate,
          threshold: String(task.threshold || 50),
          targetPrice: task.targetPrice ? String(task.targetPrice) : "",
          notifyOnDrop: task.notifyOnDrop !== false,
          checkIntervalSec: String(task.checkIntervalSec || 600),
          pushplusToken: task.pushplusToken || "",
          active: task.active !== false
        },
        placeFromText: task.placeFrom ? getCityByCode(task.placeFrom) || task.placeFrom : "",
        placeToText: task.placeTo ? getCityByCode(task.placeTo) || task.placeTo : "",
        fromPickerIndex: fromIndex >= 0 ? fromIndex : 0,
        toPickerIndex: toIndex >= 0 ? toIndex : 0,
        departDateLabel: departDate ? formatDateShort(departDate) : "",
        departDateValue: departDate ? `${departDate.slice(0, 4)}-${departDate.slice(4, 6)}-${departDate.slice(6, 8)}` : "",
        returnDateLabel: returnDate ? formatDateShort(returnDate) : "",
        returnDateValue: returnDate ? `${returnDate.slice(0, 4)}-${returnDate.slice(4, 6)}-${returnDate.slice(6, 8)}` : ""
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

  openFromPicker() {
    this.setData({ showFromPicker: true });
  },

  openToPicker() {
    this.setData({ showToPicker: true });
  },

  onAirportConfirm(e) {
    const key = e.currentTarget.dataset.key;
    const index = e.detail.value[0];
    const option = AIRPORT_OPTIONS[index];
    if (!option) return;
    if (key === "from") {
      this.setData({
        "form.placeFrom": option.value,
        placeFromText: getCityByCode(option.value) || option.value,
        fromPickerIndex: index,
        showFromPicker: false
      });
    } else {
      this.setData({
        "form.placeTo": option.value,
        placeToText: getCityByCode(option.value) || option.value,
        toPickerIndex: index,
        showToPicker: false
      });
    }
  },

  onAirportCancel(e) {
    const key = e.currentTarget.dataset.key;
    if (key === "from") {
      this.setData({ showFromPicker: false });
    } else {
      this.setData({ showToPicker: false });
    }
  },

  openFlightWayPicker() {
    this.setData({ showFlightWayPicker: true });
  },

  onFlightWayConfirm(event) {
    const index = event.detail.value[0];
    this.setData({ flightWayIndex: index, showFlightWayPicker: false });
  },

  onFlightWayCancel() {
    this.setData({ showFlightWayPicker: false });
  },

  openDepartDatePicker() {
    this.setData({ showDepartDatePicker: true });
  },

  openReturnDatePicker() {
    this.setData({ showReturnDatePicker: true });
  },

  onDepartDateConfirm(e) {
    const dateValue = e.detail.value;
    if (!dateValue) return;
    const code = dateValue.replace(/-/g, "");
    this.setData({
      departDateLabel: formatDateShort(code),
      departDateValue: dateValue,
      "form.departDates": code,
      showDepartDatePicker: false
    });
  },

  onDepartDateCancel() {
    this.setData({ showDepartDatePicker: false });
  },

  onReturnDateConfirm(e) {
    const dateValue = e.detail.value;
    if (!dateValue) return;
    const code = dateValue.replace(/-/g, "");
    this.setData({
      returnDateLabel: formatDateShort(code),
      returnDateValue: dateValue,
      "form.returnDates": code,
      showReturnDatePicker: false
    });
  },

  onReturnDateCancel() {
    this.setData({ showReturnDatePicker: false });
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

    const autoName = generateTaskName(form, flightWayIndex);

    const payload = {
      ...form,
      name: autoName,
      flightWay: FLIGHT_WAYS[flightWayIndex],
      placeFrom: form.placeFrom.toUpperCase(),
      placeTo: form.placeTo.toUpperCase(),
      targetPrice: form.targetPrice ? Number(form.targetPrice) : null
    };

    this.setData({ submitting: true });
    try {
      if (form.pushplusToken) {
        wx.setStorageSync("pushplus_token", form.pushplusToken);
      }

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
