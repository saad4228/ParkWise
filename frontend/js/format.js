// Turning the backend's raw numbers into something readable.
//
// The server speaks in paise and Unix timestamps because those are exact.
// Everything in this file is presentation only - no value formatted here
// is ever sent back as a number the server would trust.

/** Escapes text before it goes anywhere near innerHTML. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 12000 paise -> "₹120.00" */
export function money(paise) {
  const amount = Number(paise || 0) / 100;
  return '₹' + amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 12000 paise -> "₹120" when it is a whole rupee amount. */
export function moneyShort(paise) {
  const amount = Number(paise || 0) / 100;
  if (Number.isInteger(amount)) {
    return '₹' + amount.toLocaleString('en-IN');
  }
  return money(paise);
}

/** 145 -> "2 hrs 25 mins" */
export function duration(minutes) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins} min${mins === 1 ? '' : 's'}`;
  if (mins === 0) return `${hours} hr${hours === 1 ? '' : 's'}`;
  return `${hours} hr${hours === 1 ? '' : 's'} ${mins} min${mins === 1 ? '' : 's'}`;
}

function toDate(timestampSeconds) {
  return new Date(Number(timestampSeconds) * 1000);
}

/** Unix seconds -> "9 Oct 2026, 2:30 PM" in the browser's own timezone. */
export function dateTime(timestampSeconds) {
  if (!timestampSeconds) return '—';
  return toDate(timestampSeconds).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

/** Unix seconds -> "2:30 PM" */
export function timeOnly(timestampSeconds) {
  if (!timestampSeconds) return '—';
  return toDate(timestampSeconds).toLocaleTimeString('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

/** Unix seconds -> "9 Oct 2026" */
export function dateOnly(timestampSeconds) {
  if (!timestampSeconds) return '—';
  return toDate(timestampSeconds).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** "just now", "12 mins ago", "3 hrs ago" - for the activity feed. */
export function relativeTime(timestampSeconds, nowSeconds) {
  const diff = Math.floor((Number(nowSeconds) - Number(timestampSeconds)));
  if (!Number.isFinite(diff)) return '';
  if (diff < 60) return 'just now';
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return dateOnly(timestampSeconds);
}

/** 14 -> "2 PM – 3 PM", for the peak hour card. */
export function hourRange(hour) {
  if (hour === null || hour === undefined || hour < 0) return '—';
  const label = (h) => {
    const wrapped = ((h % 24) + 24) % 24;
    const suffix = wrapped < 12 ? 'AM' : 'PM';
    const display = wrapped % 12 === 0 ? 12 : wrapped % 12;
    return `${display} ${suffix}`;
  };
  return `${label(hour)} – ${label(hour + 1)}`;
}

export function vehicleTypeLabel(type) {
  return { BIKE: 'Bike', CAR: 'Car', SUV: 'SUV' }[type] || type || '';
}

// ---------------------------------------------------------------------------
// datetime-local inputs <-> Unix seconds
// ---------------------------------------------------------------------------

/** Reads an <input type="datetime-local"> as Unix seconds in local time. */
export function datetimeLocalToTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value); // the browser reads this as local time
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000);
}

/** Formats Unix seconds for a datetime-local input. */
export function timestampToDatetimeLocal(timestampSeconds) {
  const date = toDate(timestampSeconds);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
         `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Formats Unix seconds for a plain date input. */
export function timestampToDateInput(timestampSeconds) {
  const date = toDate(timestampSeconds);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Start of the local day a date input refers to, as Unix seconds. */
export function dateInputToStartTimestamp(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 1000);
}

/** Start of the day AFTER a date input, so ranges can stay end-exclusive. */
export function dateInputToEndTimestamp(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime() / 1000);
}
