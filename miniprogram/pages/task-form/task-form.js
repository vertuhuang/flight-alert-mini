const { request } = require("../../utils/request");
const { getCityByCode, AIRPORTS } = require("../../utils/airports");
const { formatDateShort, formatDateLong } = require("../../utils/format");
const { requestSubscribe, ensureOpenid, markSubscribed, SUBSCRIBE_TEMPLATE_ID } = require("../../utils/subscribe");
const { CURRENCIES } = require("../../utils/currencies");

const FLIGHT_WAYS = ["Oneway", "Roundtrip"];
const FLIGHT_WAY_LABELS = ["单程", "往返"];
const FLIGHT_WAY_OPTIONS = [
  { label: "单程", value: "Oneway" },
  { label: "往返", value: "Roundtrip" }
];

const AIRPORT_OPTIONS = AIRPORTS.map((a) => ({ label: `${a.city} (${a.code})`, value: a.code }));
const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ label: `${c.name} (${c.code})`, value: c.code }));

const MONITOR_TYPES = ["flight", "exchange_rate"];

function generateTaskName(form, flightWayIndex, monitorType) {
  if (monitorType === "exchange_rate") {
    const base = form.baseCurrency || "";
    const quote = form.quoteCurrency || "";
    if (base && quote) return `${base}/${quote} 汇率监控`;
    return "";
  }

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
    monitorTypeIndex: 0,
    monitorTypeValue: MONITOR_TYPES[0],
    isEdit: false,
    taskId: "",
    flightWayLabels: FLIGHT_WAY_LABELS,
    flightWayIndex: 0,
    flightWayValue: FLIGHT_WAYS[0],
    flightWayOptions: [FLIGHT_WAY_OPTIONS],
    airportOptions: AIRPORT_OPTIONS,
    currencyOptions: CURRENCY_OPTIONS,
    baseCurrencyIndex: 0,
    quoteCurrencyIndex: 0,
    baseCurrencyText: "",
    quoteCurrencyText: "",
    // 今天日期字符串（YYYY-MM-DD），用于限制日期选择器最小可选日期
    todayStr: "",
    // 今天 00:00:00 的时间戳（毫秒），用于限制日期选择器最小可选日期
    todayTimestamp: 0,
    form: {
      placeFrom: "",
      placeTo: "",
      baseCurrency: "",
      quoteCurrency: "",
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
    showBaseCurrencyPicker: false,
    showQuoteCurrencyPicker: false,
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
      const isFx = query.monitorType === "exchange_rate";
      const baseData = {
        todayTimestamp,
        todayStr,
        "form.pushplusToken": savedToken || ""
      };

      // 如果从 FAB 浮层传入了监控类型参数，预选择
      if (isFx) {
        baseData.monitorTypeIndex = 1;
        baseData.monitorTypeValue = "exchange_rate";
        baseData["form.threshold"] = "0.01";
        baseData["form.checkIntervalSec"] = "300";
      }

      wx.setNavigationBarTitle({ title: isFx ? "创建汇率监控" : "创建机票监控" });
      this.setData(baseData);
    }
  },

  async loadTask(id) {
    try {
      const task = await request({ url: `/tasks/${id}` });
      const monitorType = task.monitorType || "flight";
      const monitorTypeIndex = MONITOR_TYPES.indexOf(monitorType);
      wx.setNavigationBarTitle({ title: `编辑${monitorType === "exchange_rate" ? "汇率" : "机票"}监控` });
      const flightWayIndex = task.flightWay === "Roundtrip" ? 1 : 0;
      const departDates = task.departDates || [];
      const returnDates = task.returnDates || [];
      const departDate = Array.isArray(departDates) ? departDates[0] || "" : departDates;
      const returnDate = Array.isArray(returnDates) ? returnDates[0] || "" : returnDates;
      const fromIndex = AIRPORT_OPTIONS.findIndex((o) => o.value === task.placeFrom);
      const toIndex = AIRPORT_OPTIONS.findIndex((o) => o.value === task.placeTo);
      const baseIndex = CURRENCY_OPTIONS.findIndex((o) => o.value === task.baseCurrency);
      const quoteIndex = CURRENCY_OPTIONS.findIndex((o) => o.value === task.quoteCurrency);

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
        monitorType,
        monitorTypeIndex: monitorTypeIndex >= 0 ? monitorTypeIndex : 0,
        flightWayIndex,
        flightWayValue: FLIGHT_WAYS[flightWayIndex],
        baseCurrencyIndex: baseIndex >= 0 ? baseIndex : 0,
        quoteCurrencyIndex: quoteIndex >= 0 ? quoteIndex : 0,
        baseCurrencyText: task.baseCurrency ? (CURRENCIES.find(c => c.code === task.baseCurrency)?.name || task.baseCurrency) : "",
        quoteCurrencyText: task.quoteCurrency ? (CURRENCIES.find(c => c.code === task.quoteCurrency)?.name || task.quoteCurrency) : "",
        form: {
          placeFrom: task.placeFrom || "",
          placeTo: task.placeTo || "",
          baseCurrency: task.baseCurrency || "",
          quoteCurrency: task.quoteCurrency || "",
          departDates: finalDepartDate,
          returnDates: finalReturnDate,
          threshold: String(task.threshold || (monitorType === "exchange_rate" ? 0.01 : 50)),
          targetPrice: task.targetPrice ? String(task.targetPrice) : "",
          notifyOnDrop: task.notifyOnDrop !== false,
          checkIntervalSec: String(task.checkIntervalSec || (monitorType === "exchange_rate" ? 300 : 600)),
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

  openBaseCurrencyPicker() {
    this.setData({ showBaseCurrencyPicker: true });
  },

  openQuoteCurrencyPicker() {
    this.setData({ showQuoteCurrencyPicker: true });
  },

  onBaseCurrencyChange(e) {
    const value = e.detail.value[0];
    const index = CURRENCY_OPTIONS.findIndex((o) => o.value === value);
    if (index >= 0) {
      const currency = CURRENCIES[index];
      this.setData({
        baseCurrencyIndex: index,
        "form.baseCurrency": currency.code,
        baseCurrencyText: currency.name,
        showBaseCurrencyPicker: false
      });
    }
  },

  onQuoteCurrencyChange(e) {
    const value = e.detail.value[0];
    const index = CURRENCY_OPTIONS.findIndex((o) => o.value === value);
    if (index >= 0) {
      const currency = CURRENCIES[index];
      this.setData({
        quoteCurrencyIndex: index,
        "form.quoteCurrency": currency.code,
        quoteCurrencyText: currency.name,
        showQuoteCurrencyPicker: false
      });
    }
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

    const { form, monitorTypeIndex, isEdit, taskId } = this.data;
    const monitorType = MONITOR_TYPES[monitorTypeIndex];

    if (monitorType === "exchange_rate") {
      // 汇率监控校验
      if (!form.baseCurrency) {
        wx.showToast({ title: "请选择基础货币", icon: "none" });
        return;
      }
      if (!form.quoteCurrency) {
        wx.showToast({ title: "请选择报价货币", icon: "none" });
        return;
      }
      if (form.baseCurrency === form.quoteCurrency) {
        wx.showToast({ title: "基础货币和报价货币不能相同", icon: "none" });
        return;
      }
    } else {
      // 机票监控校验
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
      if (this.data.flightWayIndex === 1 && form.returnDates && Number(form.returnDates) < Number(todayStr)) {
        wx.showToast({ title: "返程日期不能早于今天", icon: "none" });
        return;
      }
    }

    const autoName = generateTaskName(form, this.data.flightWayIndex, monitorType);
    let subscribeAccepted = false;

    // 获取 openid（如果开启了订阅消息）
    let openid = "";
    if (form.subscribeEnabled && SUBSCRIBE_TEMPLATE_ID) {
      openid = await ensureOpenid();
    }

    // 按监控类型分别构建 payload，避免字段互相污染
    const commonPayload = {
      name: autoName,
      monitorType,
      threshold: Number(form.threshold) || (monitorType === "exchange_rate" ? 0.01 : 50),
      checkIntervalSec: Number(form.checkIntervalSec) || (monitorType === "exchange_rate" ? 300 : 600),
      targetPrice: form.targetPrice ? Number(form.targetPrice) : null,
      notifyOnDrop: form.notifyOnDrop,
      pushplusToken: form.pushplusToken,
      subscribeEnabled: form.subscribeEnabled,
      active: form.active,
      openid
    };

    let payload;
    if (monitorType === "exchange_rate") {
      payload = {
        ...commonPayload,
        baseCurrency: form.baseCurrency.toUpperCase(),
        quoteCurrency: form.quoteCurrency.toUpperCase()
        // 故意不包含机票字段
      };
    } else {
      payload = {
        ...commonPayload,
        flightWay: FLIGHT_WAYS[this.data.flightWayIndex],
        placeFrom: form.placeFrom.toUpperCase(),
        placeTo: form.placeTo.toUpperCase(),
        departDates: form.departDates,
        returnDates: form.returnDates || undefined
        // 故意不包含汇率字段
      };
    }

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
