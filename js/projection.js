// Projection math, mirroring the workbook's SETTINGS formulas (monthly compounding).
import { addMonthsKey, todayKey, parseKey, ageAt } from './dates.js';

/** Future value: pv grows at annual/12 per month and receives `monthly` at each month end (Excel FV). */
export function futureValue({ pv, monthly, annual, years }) {
  const n = Math.round(12 * years);
  const r = annual / 12;
  if (r === 0) return pv + monthly * n;
  const g = Math.pow(1 + r, n);
  return pv * g + monthly * (g - 1) / r;
}

/** Years until `goal` is reached; 0 if already there; Infinity if never. */
export function yearsToGoal({ goal, pv, monthly, annual }) {
  if (pv >= goal) return 0;
  const r = annual / 12;
  if (r === 0) return monthly > 0 ? (goal - pv) / (monthly * 12) : Infinity;
  const k = monthly / r;
  const num = goal + k, den = pv + k;
  if (den <= 0 || num / den <= 0) return Infinity;
  const months = Math.log(num / den) / Math.log(1 + r);
  return months >= 0 && isFinite(months) ? months / 12 : Infinity;
}

/** Month key ~years from today (Excel: EDATE(TODAY(), ROUND(years*12))). */
export function dateAfterYears(years, now = new Date()) {
  if (!isFinite(years)) return null;
  return addMonthsKey(todayKey(now), Math.round(years * 12));
}

/** Age at a month key, given birth {y,m,d}. Uses the first of that month, like the workbook's dates. */
export function ageAtKey(birth, key) {
  if (!birth || !key) return null;
  const { y, m } = parseKey(key);
  return ageAt(birth, { y, m, d: 1 });
}

/** Cost of starting `delay` years late, measured at the end of the horizon. */
export function costOfWaiting({ pv, monthly, annual, horizon, delays = [1, 5, 10] }) {
  const full = futureValue({ pv, monthly, annual, years: horizon });
  return delays.map((delay) => {
    const years = Math.max(horizon - delay, 0);
    const value = futureValue({ pv, monthly, annual, years });
    return { delay, years, value, cost: full - value };
  });
}

/** Quest milestones: union of standard nodes and the workbook's own milestone goals. */
export const STANDARD_MILESTONES = [10000, 50000, 100000, 250000, 500000, 1000000];
export function milestoneGoals(excelMilestones = []) {
  const set = new Set(STANDARD_MILESTONES);
  for (const m of excelMilestones) if (m.goal > 0) set.add(m.goal);
  return [...set].sort((a, b) => a - b);
}
