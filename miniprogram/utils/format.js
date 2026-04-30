function formatDateCode(value) {
  if (!value || value.length !== 8) {
    return value || "";
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMonthDayTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const pad = (num) => String(num).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function joinDates(list) {
  return (list || []).map(formatDateCode).join(", ");
}

function formatDateShort(dateCode) {
  if (!dateCode || dateCode.length !== 8) return dateCode || "";
  const month = dateCode.slice(4, 6).replace(/^0/, "");
  const day = dateCode.slice(6, 8).replace(/^0/, "");
  return `${month}月${day}日`;
}

function formatDateLong(dateCode) {
  if (!dateCode || dateCode.length !== 8) return dateCode || "";
  const year = dateCode.slice(0, 4);
  const month = dateCode.slice(4, 6);
  const day = dateCode.slice(6, 8);
  return `${year}年${month}月${day}日`;
}

function joinDatesShort(list) {
  return (list || []).map(formatDateShort).join("、");
}

module.exports = {
  formatDateCode,
  formatDateTime,
  formatMonthDayTime,
  joinDates,
  formatDateShort,
  formatDateLong,
  joinDatesShort
};
