// 常用货币列表
const CURRENCIES = [
  { code: "USD", name: "美元" },
  { code: "EUR", name: "欧元" },
  { code: "GBP", name: "英镑" },
  { code: "HKD", name: "港币" },
  { code: "JPY", name: "日元" },
  { code: "CNY", name: "人民币" },
  { code: "AUD", name: "澳元" },
  { code: "CAD", name: "加元" },
  { code: "CHF", name: "瑞郎" },
  { code: "SGD", name: "新加坡元" },
  { code: "KRW", name: "韩元" },
  { code: "THB", name: "泰铢" },
  { code: "MYR", name: "马币" },
  { code: "TWD", name: "新台币" },
  { code: "NZD", name: "新西兰元" },
  { code: "SEK", name: "瑞典克朗" },
  { code: "NOK", name: "挪威克朗" },
  { code: "DKK", name: "丹麦克朗" }
];

const CURRENCY_MAP = {};
for (const c of CURRENCIES) {
  CURRENCY_MAP[c.code] = c.name;
}

function getCurrencyName(code) {
  return CURRENCY_MAP[code] || code;
}

module.exports = {
  CURRENCIES,
  CURRENCY_MAP,
  getCurrencyName
};
