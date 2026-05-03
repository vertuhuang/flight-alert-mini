const { request } = require("../../utils/request");
const { getCityByCode, AIRPORTS } = require("../../utils/airports");
const { formatDateShort, formatDateLong } = require("../../utils/format");
const { requestSubscribe, ensureOpenid, markSubscribed, SUBSCRIBE_TEMPLATE_ID } = require("../../utils/subscribe");

const FLIGHT_WAYS = ["Oneway", "Roundtrip"];
const FLIGHT_WAY_LABELS = ["单程", "往返"];
const FLIGHT_WAY_OPTIONS = [
  { label: "单程", value: "Oneway" },
  { label: "往返", value: "Roundtrip" }
];

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
    flightWayValue: FLIGHT_WAYS[0],
    flightWayOptions: [FLIGHT_WAY_OPTIONS],
    airportOptions: AIRPORT_OPTIONS,
    // 今天日期字符串（YYYY-MM-DD），用于限制日期选择器最小可选日期
    todayStr: "",
    // 今天 00:00:00 的时间戳（毫秒），用于限制日期选择器最小可选日期
    todayTimestamp: 0,
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
      subscribeEnabled: !!SUBSCRIBE_TEMPLATE_ID,
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
    // 计算今天日期字符串和今天零点的时间戳，用于限制日期选择器最小可选日期
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayTimestamp = todayMidnight.getTime();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (query.id) {
      this.setData({ isEdit: true, taskId: query.id, todayTimestamp, todayStr });
      this.loadTask(query.id);
    } else {
      const savedToken = wx.getStorageSync("pushplus_token");
      this.setData({
        todayTimestamp,
        todayStr,
        "form.pushplusToken": savedToken || ""
      });
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

      // 检查日期是否早于今天，如果是则自动调整为今天
      const now = new Date();
      const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      let finalDepartDate = departDate;
      let finalReturnDate = returnDate;
      let dateAdjusted = false;

      if (departDate && Number(departDate) < Number(todayStr)) {
        finalDepartDate = todayStr;
        dateAdjusted = true;
      }
      if (returnDate && Number(returnDate) < Number(todayStr)) {
        finalReturnDate = todayStr;
        dateAdjusted = true;
      }

      if (dateAdjusted) {
        wx.showToast({ title: "原日期已过期，已自动调整为今天", icon: "none", duration: 2000 });
      }

      this.setData({
        flightWayIndex,
        flightWayValue: FLIGHT_WAYS[flightWayIndex],
        form: {
          placeFrom: task.placeFrom || "",
          placeTo: task.placeTo || "",
          departDates: finalDepartDate,
          returnDates: finalReturnDate,
          threshold: String(task.threshold || 50),
          targetPrice: task.targetPrice ? String(task.targetPrice) : "",
          notifyOnDrop: task.notifyOnDrop !== false,
          checkIntervalSec: String(task.checkIntervalSec || 600),
          pushplusToken: task.pushplusToken || "",
          subscribeEnabled: task.subscribeEnabled !== false,
          active: task.active !== false
        },
        placeFromText: task.placeFrom ? getCityByCode(task.placeFrom) || task.placeFrom : "",
        placeToText: task.placeTo ? getCityByCode(task.placeTo) || task.placeTo : "",
        fromPickerIndex: fromIndex >= 0 ? fromIndex : 0,
        toPickerIndex: toIndex >= 0 ? toIndex : 0,
        departDateLabel: finalDepartDate ? formatDateLong(finalDepartDate) : "",
        departDateValue: finalDepartDate ? `${finalDepartDate.slice(0, 4)}-${finalDepartDate.slice(4, 6)}-${finalDepartDate.slice(6, 8)}` : "",
        returnDateLabel: finalReturnDate ? formatDateLong(finalReturnDate) : "",
        returnDateValue: finalReturnDate ? `${finalReturnDate.slice(0, 4)}-${finalReturnDate.slice(4, 6)}-${finalReturnDate.slice(6, 8)}` : ""
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
    const picker = this.selectComponent("#fromPicker");
    if (picker) picker.open();
  },

  openToPicker() {
    const picker = this.selectComponent("#toPicker");
    if (picker) picker.open();
  },

  onFromChange(e) {
    const { code, city } = e.detail;
    this.setData({
      "form.placeFrom": code,
      placeFromText: city || getCityByCode(code) || code
    });
  },

  onToChange(e) {
    const { code, city } = e.detail;
    this.setData({
      "form.placeTo": code,
      placeToText: city || getCityByCode(code) || code
    });
  },

  openFlightWayPicker() {
    this.setData({ showFlightWayPicker: true });
  },

  onFlightWayConfirm(event) {
    const value = event.detail.value[0];
    const index = FLIGHT_WAYS.indexOf(value);
    if (index >= 0) {
      this.setData({ flightWayIndex: index, flightWayValue: value, showFlightWayPicker: false });
    }
  },

  onFlightWayCancel() {
    this.setData({ showFlightWayPicker: false });
  },

  openDepartDatePicker() {
    let { departDateValue } = this.data;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    if (!departDateValue || departDateValue < todayStr) {
      departDateValue = todayStr;
    }
    this.setData({ departDateValue, showDepartDatePicker: true });
  },

  openReturnDatePicker() {
    let { returnDateValue } = this.data;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    if (!returnDateValue || returnDateValue < todayStr) {
      returnDateValue = todayStr;
    }
    this.setData({ returnDateValue, showReturnDatePicker: true });
  },

  onDepartDateConfirm(e) {
    const dateValue = e.detail.value;
    if (!dateValue) return;
    const datePart = dateValue.slice(0, 10);
    const code = datePart.replace(/-/g, "");
    this.setData({
      departDateLabel: formatDateLong(code),
      departDateValue: datePart,
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
    const datePart = dateValue.slice(0, 10);
    const code = datePart.replace(/-/g, "");
    this.setData({
      returnDateLabel: formatDateLong(code),
      returnDateValue: datePart,
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

  onSubscribeChange(event) {
    this.setData({ "form.subscribeEnabled": event.detail.value });
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

    // 校验出发日期不能早于今天
    const now = new Date();
    const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    if (!form.departDates) {
      wx.showToast({ title: "请选择出发日期", icon: "none" });
      return;
    }
    if (Number(form.departDates) < Number(todayStr)) {
      wx.showToast({ title: "出发日期不能早于今天", icon: "none" });
      return;
    }
    if (flightWayIndex === 1 && form.returnDates && Number(form.returnDates) < Number(todayStr)) {
      wx.showToast({ title: "返程日期不能早于今天", icon: "none" });
      return;
    }

    const autoName = generateTaskName(form, flightWayIndex);
    let subscribeAccepted = false;

    // 获取 openid（如果开启了订阅消息）
    let openid = "";
    if (form.subscribeEnabled && SUBSCRIBE_TEMPLATE_ID) {
      openid = await ensureOpenid();
    }

    const payload = {
      ...form,
      name: autoName,
      flightWay: FLIGHT_WAYS[flightWayIndex],
      placeFrom: form.placeFrom.toUpperCase(),
      placeTo: form.placeTo.toUpperCase(),
      targetPrice: form.targetPrice ? Number(form.targetPrice) : null,
      openid
    };

    this.setData({ submitting: true });
    try {
      // 请求订阅消息授权（在创建任务前）
      if (form.subscribeEnabled && SUBSCRIBE_TEMPLATE_ID) {
        const subscribeRes = await requestSubscribe();
        subscribeAccepted = subscribeRes[SUBSCRIBE_TEMPLATE_ID] === "accept";
        if (!isEdit && subscribeAccepted) {
          payload.subscribeQuota = 1;
        }
      }

      if (form.pushplusToken) {
        wx.setStorageSync("pushplus_token", form.pushplusToken);
      }

      if (isEdit) {
        await request({
          url: `/tasks/${taskId}`,
          method: "PATCH",
          data: payload
        });
        if (form.subscribeEnabled && subscribeAccepted) {
          await request({
            url: `/tasks/${taskId}/subscribe-quota`,
            method: "POST",
            data: { amount: 1 }
          });
        }
        wx.showToast({ title: "更新成功", icon: "success" });
        if (form.subscribeEnabled && subscribeAccepted) {
          markSubscribed(taskId);
        }
      } else {
        const task = await request({
          url: "/tasks",
          method: "POST",
          data: payload
        });
        wx.showToast({ title: "创建成功", icon: "success" });
        if (form.subscribeEnabled && subscribeAccepted && task.id) {
          markSubscribed(task.id);
        }
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
