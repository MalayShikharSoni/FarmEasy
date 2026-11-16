// <input type="datetime-local"> works in the browser's local time and has no
// timezone. `toISOString().slice(0, 16)` would fill it with UTC, which shows
// 5h30m behind in India, so convert explicitly in both directions.

/** Date (or date string) -> "YYYY-MM-DDTHH:mm" in local time, for the input. */
export const toLocalInputValue = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

/** Input value (local time) -> ISO string with timezone, for the API. */
export const fromLocalInputValue = (value) => (value ? new Date(value).toISOString() : undefined);
