// Date helpers. Local time only; no UTC date keys.
// Excel stores dates as serial day numbers (1900 system, with the 1900 leap-year bug).
// We convert the serial to y/m/d with pure integer arithmetic, so no timezone can shift it.

/** Excel serial (number) -> {y, m, d} (m is 1-12). Returns null for non-dates. */
export function serialToYMD(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  const whole = Math.floor(serial + 1e-7);
  if (whole < 1 || whole > 2958465) return null;
  // Days since 1899-12-30 (accounts for Excel's fake 1900-02-29 for serials > 60).
  let days = whole;
  if (whole <= 60) days = whole + 1; // pre-March-1900 serials (never used for real data)
  // Civil-from-days (Howard Hinnant), epoch 1970-01-01. Serial 25569 = 1970-01-01.
  const z = days - 25569 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return { y, m, d };
}

/** Accept an Excel serial, a 'YYYY-MM(-DD)' string or a Date; return {y,m,d} or null. */
export function toYMD(v) {
  if (typeof v === 'number') return serialToYMD(v);
  if (v instanceof Date && !isNaN(v)) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  if (typeof v === 'string') {
    const s = v.trim();
    let mt = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (mt) return { y: +mt[1], m: +mt[2], d: mt[3] ? +mt[3] : 1 };
    mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/mm/yyyy (pt-PT)
    if (mt) return { y: +mt[3], m: +mt[2], d: +mt[1] };
  }
  return null;
}

export const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM' month key from {y,m}. */
export const monthKey = (ymd) => `${ymd.y}-${pad2(ymd.m)}`;

/** Parse a month key into {y, m}. */
export function parseKey(key) {
  const [y, m] = key.split('-').map(Number);
  return { y, m };
}

/** Add n months to a month key (pure integer math). */
export function addMonthsKey(key, n) {
  const { y, m } = parseKey(key);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
}

/** Difference in whole months b - a for month keys. */
export function monthDiff(a, b) {
  const A = parseKey(a), B = parseKey(b);
  return (B.y * 12 + B.m) - (A.y * 12 + A.m);
}

/** Noon-anchored local Date for a y/m/d (avoids DST/midnight drift). */
export function noonDate(y, m, d = 1) {
  return new Date(`${y}-${pad2(m)}-${pad2(d)}T12:00:00`);
}

/** Today's month key in local time. */
export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

/** Whole years between birth {y,m,d} and a target {y,m,d} (like DATEDIF "Y"). */
export function ageAt(birth, at) {
  if (!birth || !at) return null;
  let age = at.y - birth.y;
  if (at.m < birth.m || (at.m === birth.m && (at.d || 1) < birth.d)) age -= 1;
  return age;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function labelKey(key, style = 'short') {
  const { y, m } = parseKey(key);
  return style === 'long' ? `${MONTHS_LONG[m - 1]} ${y}` : `${MONTHS_SHORT[m - 1]} ${y}`;
}
export function labelKeyTiny(key) {
  const { y, m } = parseKey(key);
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}
export function monthName(key) {
  return MONTHS_SHORT[parseKey(key).m - 1];
}
