function formatDate(isoString, timeFormat, options = {}) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const {
    weekday,
    month = 'short',
    day = 'numeric',
    year,
    showTime = true
  } = options;

  const dateParts = {};
  if (weekday) dateParts.weekday = weekday;
  if (month) dateParts.month = month;
  if (day) dateParts.day = day;
  if (year) dateParts.year = year;

  let result = date.toLocaleDateString('en-US', dateParts);

  if (showTime) {
    const is12h = timeFormat === '12h';
    const timeParts = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: is12h
    };
    result += ' ' + date.toLocaleTimeString('en-US', timeParts);
  }

  return result;
}

function formatTime(isoString, timeFormat) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const is12h = timeFormat === '12h';
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: is12h
  });
}

module.exports = { formatDate, formatTime };
