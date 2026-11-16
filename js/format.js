// Portuguese number format everywhere: 12 345 €, 9,5%, 7,2. One style, one place.
const NBSP = ' ';
const MINUS = '−';

/** Group thousands with a no-break space and use a decimal comma. Always groups (also 4-digit numbers). */
export function fmtNumber(n, decimals = 0) {
  if (n == null || !isFinite(n)) return '–';
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  let [int, frac] = fixed.split('.');
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const s = frac ? `${int},${frac}` : int;
  return (neg && Number(fixed) !== 0 ? MINUS : '') + s;
}

/** 12 345 € (no decimals by default). */
export function fmtEur(n, decimals = 0) {
  if (n == null || !isFinite(n)) return '–';
  return `${fmtNumber(n, decimals)}${NBSP}€`;
}

/** Signed money: +1 260 € / −340 €. */
export function fmtEurSigned(n, decimals = 0) {
  if (n == null || !isFinite(n)) return '–';
  const s = fmtEur(n, decimals);
  return n > 0 && Math.abs(n) >= 0.5 * Math.pow(10, -decimals) ? `+${s}` : s;
}

/** Compact money for axes: 950 €, 13 k€, 1,2 M€. */
export function fmtEurCompact(n) {
  if (n == null || !isFinite(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e6) return `${fmtNumber(n / 1e6, a >= 1e7 ? 0 : 1)}${NBSP}M€`;
  if (a >= 1e4) return `${fmtNumber(n / 1e3, 0)}${NBSP}k€`;
  if (a >= 1e3) return `${fmtNumber(n / 1e3, Number.isInteger(Math.round(n) / 1e3) ? 0 : 1)}${NBSP}k€`;
  return fmtEur(n);
}

/** Fraction -> percent: 0.095 -> 9,5%. */
export function fmtPct(f, decimals = 1) {
  if (f == null || !isFinite(f)) return '–';
  return `${fmtNumber(f * 100, decimals)}%`;
}

/** Signed percentage points: +2,4 pts. */
export function fmtPts(f, decimals = 1) {
  if (f == null || !isFinite(f)) return '–';
  const v = f * 100;
  const s = fmtNumber(v, decimals);
  return `${v > 0 && Number(v.toFixed(decimals)) !== 0 ? '+' : ''}${s}${NBSP}pts`;
}

export function fmtSignedPct(f, decimals = 1) {
  if (f == null || !isFinite(f)) return '–';
  const s = fmtPct(f, decimals);
  return f > 0 && Number((f * 100).toFixed(decimals)) !== 0 ? `+${s}` : s;
}

/** Years with one decimal, approximate: ~7,2 years. */
export function fmtYears(y) {
  if (y == null) return '–';
  if (!isFinite(y)) return 'not reached';
  if (y === 0) return 'reached';
  return `~${fmtNumber(y, 1)}${NBSP}years`;
}

export function fmtMonths(m, decimals = 1) {
  if (m == null || !isFinite(m)) return '–';
  return `${fmtNumber(m, decimals)}${NBSP}months`;
}

export function fmtXP(n) { return `${fmtNumber(n, 0)}${NBSP}XP`; }
