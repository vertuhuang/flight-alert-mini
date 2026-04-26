const { searchAirports, groupByLetter, formatAirportDisplay } = require("../../utils/airports");

Component({
  properties: {
    label: { type: String, value: "选择城市" },
    placeholder: { type: String, value: "请选择" },
    value: { type: String, value: "" },
    showTrigger: { type: Boolean, value: true }
  },

  data: {
    visible: false,
    keyword: "",
    groups: [],
    sidebarLetters: [],
    selectedCode: "",
    selectedCity: "",
    displayText: "",
    scrollInto: "",
    activeLetter: ""
  },

  observers: {
    value(code) {
      if (code) {
        this.setData({
          selectedCode: code,
          displayText: formatAirportDisplay(code)
        });
      } else {
        this.setData({
          selectedCode: "",
          displayText: ""
        });
      }
    }
  },

  lifetimes: {
    attached() {
      const groups = groupByLetter(require("../../utils/airports").AIRPORTS);
      const sidebarLetters = groups.map((g) => g.letter);
      this.setData({ groups, sidebarLetters });
    }
  },

  methods: {
    noop() {},

    open() {
      const allGroups = groupByLetter(require("../../utils/airports").AIRPORTS);
      this.setData({
        visible: true,
        keyword: "",
        groups: allGroups,
        selectedCode: this.properties.value || ""
      });
    },

    close() {
      this.setData({ visible: false });
    },

    onSearch(e) {
      const keyword = e.detail.value;
      const groups = searchAirports(keyword);
      const sidebarLetters = groups.map((g) => g.letter);
      this.setData({ keyword, groups, sidebarLetters });
    },

    onSelect(e) {
      const { code, city } = e.currentTarget.dataset;
      this.setData({
        selectedCode: code,
        selectedCity: city,
        visible: false,
        displayText: code ? formatAirportDisplay(code) : ""
      });
      this.triggerEvent("change", {
        code: code,
        city: city
      });
    },

    confirm() {
      const { selectedCode, selectedCity } = this.data;
      this.setData({
        visible: false,
        displayText: selectedCode ? formatAirportDisplay(selectedCode) : ""
      });
      this.triggerEvent("change", {
        code: selectedCode,
        city: selectedCity
      });
    },

    onLetterTap(e) {
      const letter = e.currentTarget.dataset.letter;
      this.setData({
        scrollInto: `letter-${letter}`,
        activeLetter: letter
      });

      // Clear active highlight after a moment
      setTimeout(() => {
        this.setData({ activeLetter: "" });
      }, 500);
    }
  }
});
