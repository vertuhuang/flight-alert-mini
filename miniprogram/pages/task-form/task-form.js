const { request } = require("../../utils/request");
const { getCityByCode } = require("../../utils/airports");
const { formatDateShort } = require("../../utils/format");

const FLIGHT_WAYS = ["Oneway", "Roundtrip"];
const FLIGHT_WAY_LABELS = ["单程", "往返"];

/**
 * 根据日期代码数组生成中文日期描述
 * ["20260501"] → "5月1日"
 * ["20260501","20260502"] → "5月1、2日"
 * ["20260501","20260601"] → "5月1日、6月1日"
 */
function formatDatesShort(dateCodes) {
  if (!dateCodes || dateCodes.length === 0) return "";
  const parts = dateCodes.map((d) => ({
    month: d.slice(4, 6).replace(/^0/, ""),
    day: d.slice(6, 8).replace(/^0/, "")
  }));
  // 同月合并
  const monthGroups = {};
  parts.forEach((p) => {
    if (!monthGroups[p.month]) monthGroups[p.month] = [];
    monthGroups[p.month].push(p.day);
  });
  const sortedMonths = Object.keys(monthGroups).sort((a, b) => a - b);
  return sortedMonths
    .map((m) => `${m}月${monthGroups[m].join("、")}日`)
    .join("、");
}

/**
 * 自动生成任务名称
 * 单程："5月1日深圳飞北京"
 * 往返："5月1-8日深圳飞北京往返"
 */
function generateTaskName(form, flightWayIndex) {
  const departDates = (form.departDates || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fromCity = getCityByCode(form.placeFrom) || form.placeFrom;
  const toCity = getCityByCode(form.placeTo) || form.placeTo;

  if (departDates.length === 0 || !fromCity || !toCity) return "";

  const first = departDates[0];
  const last = departDates[departDates.length - 1];
  const m1 = first.slice(4, 6).replace(/^0/, "");
  const d1 = first.slice(6, 8).replace(/^0/, "");
  const m2 = last.slice(4, 6).replace(/^0/, "");
  const d2 = last.slice(6, 8).replace(/^0/, "");

  let dateStr;
  if (departDates.length === 1) {
    dateStr = `${m1}月${d1}日`;
  } else if (m1 === m2) {
    dateStr = `${m1}月${d1}-${d2}日`;
  } else {
    dateStr = `${m1}月${d1}日-${m2}月${d2}日`;
  }

  const isRound = FLIGHT_WAYS[flightWayIndex || 0] === "Roundtrip";
  return `${dateStr}${fromCity}飞${toCity}${isRound ? "往返" : ""}`;
}

Page({
  data: {
    isEdit: false,
    taskId: "",
    flightWayLabels: FLIGHT_WAY_LABELS,
    flightWayIndex: 0,
    flightWayOptions: [FLIGHT_WAY_LABELS],
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
    departDateTags: [],
    returnDateTags: [],
    showDepartDatePicker: false,
    showReturnDatePicker: false,
    datePickerValue: "",
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
      this.setData({
        flightWayIndex,
        form: {
          placeFrom: task.placeFrom || "",
          placeTo: task.placeTo || "",
          departDates: departDates.join(","),
          returnDates: returnDates.join(","),
          threshold: String(task.threshold || 50),
          targetPrice: task.targetPrice ? String(task.targetPrice) : "",
          notifyOnDrop: task.notifyOnDrop !== false,
          checkIntervalSec: String(task.checkIntervalSec || 600),
          pushplusToken: task.pushplusToken || "",
          active: task.active !== false
        },
        departDateTags: departDates.map((d) => ({ code: d, label: formatDateShort(d) })),
        returnDateTags: returnDates.map((d) => ({ code: d, label: formatDateShort(d) }))
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

  openDepartDatePicker() {
    const today = new Date();
    const value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    this.setData({ showDepartDatePicker: true, datePickerValue: value });
  },

  openReturnDatePicker() {
    const today = new Date();
    const value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    this.setData({ showReturnDatePicker: true, datePickerValue: value });
  },

  onDepartDatePick(e) {
    const dateValue = e.detail.value;
    if (!dateValue) return;
    const code = dateValue.replace(/-/g, "");
    const { departDateTags } = this.data;
    if (departDateTags.some((t) => t.code === code)) {
      this.setData({ showDepartDatePicker: false });
      return;
    }
    const newTags = [...departDateTags, { code, label: formatDateShort(code) }].sort((a, b) => a.code.localeCompare(b.code));
    this.setData({
      departDateTags: newTags,
      "form.departDates": newTags.map((t) => t.code).join(","),
      showDepartDatePicker: false
    });
  },

  onReturnDatePick(e) {
    const dateValue = e.detail.value;
    if (!dateValue) return;
    const code = dateValue.replace(/-/g, "");
    const { returnDateTags } = this.data;
    if (returnDateTags.some((t) => t.code === code)) {
      this.setData({ showReturnDatePicker: false });
      return;
    }
    const newTags = [...returnDateTags, { code, label: formatDateShort(code) }].sort((a, b) => a.code.localeCompare(b.code));
    this.setData({
      returnDateTags: newTags,
      "form.returnDates": newTags.map((t) => t.code).join(","),
      showReturnDatePicker: false
    });
  },

  removeDepartDate(e) {
    const code = e.currentTarget.dataset.code;
    const newTags = this.data.departDateTags.filter((t) => t.code !== code);
    this.setData({
      departDateTags: newTags,
      "form.departDates": newTags.map((t) => t.code).join(",")
    });
  },

  removeReturnDate(e) {
    const code = e.currentTarget.dataset.code;
    const newTags = this.data.returnDateTags.filter((t) => t.code !== code);
    this.setData({
      returnDateTags: newTags,
      "form.returnDates": newTags.map((t) => t.code).join(",")
    });
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

    // 自动生成任务名称
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
