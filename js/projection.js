// Projection math, mirroring the workbook's SETTINGS formulas (monthly compounding).
import { addMonthsKey, todayKey, parseKey, ageAt } from './dates.js';
import { loadData } from './store.js';

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

/**
 * Quest milestones.
 * The first one is 10 000. After that, one milestone roughly every 6 months along the saved plan (monthly
 * contribution and yearly return from the workbook's SETTINGS), snapped to good-looking round numbers. The ladder uses the
 * saved plan, not the what-if sliders, so the targets stay put while the dates move. Beyond the ladder come the
 * long-range goals (250 000, 500 000, 1 000 000) and any goal the workbook itself lists.
 */
export const LADDER_START = 10000;
export const LADDER_STEP_MONTHS = 6;
export const LADDER_STEPS = 20; // about 10 years of 6-month milestones
export const LONG_RANGE_MILESTONES = [250000, 500000, 1000000];
/** Used when the plan is unknown (first run, tests): same idea with fixed numbers. */
export const FALLBACK_MILESTONES = [10000, 15000, 20000, 25000, 30000, 35000, 40000, 50000, 60000, 75000, 100000, 250000, 500000, 1000000];
/** Kept for older callers: the long-range part of the map. */
export const STANDARD_MILESTONES = [...LONG_RANGE_MILESTONES];

/** Good-looking milestone numbers: every 5k to 50k, every 10k to 100k, every 25k to 250k, every 50k to 500k. */
const range = (from, to, step) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
export const NICE_NUMBERS = [...range(10000, 50000, 5000), ...range(60000, 100000, 10000), ...range(125000, 250000, 25000), ...range(300000, 500000, 50000)];
const nearestNice = (v) => NICE_NUMBERS.reduce((best, n) => (Math.abs(Math.log(n / v)) < Math.abs(Math.log(best / v)) ? n : best), NICE_NUMBERS[0]);

/** The saved plan (workbook SETTINGS) read from this device; null when nothing is saved or in tests. */
export function savedPace() {
  try {
    const P = loadData()?.settings?.projection;
    if (!P) return null;
    const monthly = Number(P.monthly), annual = Number(P.annualReturn);
    return monthly > 0 || annual > 0 ? { monthly: monthly || 0, annual: annual || 0 } : null;
  } catch { return null; }
}

/** Milestones roughly `stepMonths` apart on the plan, snapped to good-looking numbers, starting at `start`. */
export function paceLadder({ monthly, annual, start = LADDER_START, steps = LADDER_STEPS, stepMonths = LADDER_STEP_MONTHS }) {
  const out = [start];
  for (let k = 1; k <= steps; k++) {
    const g = nearestNice(futureValue({ pv: start, monthly, annual, years: (k * stepMonths) / 12 }));
    if (g > out[out.length - 1]) out.push(g);
  }
  return out;
}

export function milestoneGoals(excelMilestones = [], pace = savedPace()) {
  const anchors = new Set(LONG_RANGE_MILESTONES);
  for (const m of excelMilestones) if (m.goal > 0) anchors.add(m.goal);
  const build = (steps) => {
    const ladder = pace ? paceLadder({ ...pace, steps }) : FALLBACK_MILESTONES.filter((g) => g < LONG_RANGE_MILESTONES[0]);
    // Drop ladder steps that sit within 4% of an anchor so the map has no near-duplicates.
    const kept = ladder.filter((g) => ![...anchors].some((a) => Math.abs(a - g) / a < 0.04));
    return [...new Set([...kept, ...anchors])].sort((a, b) => a - b);
  };
  let goals = build(LADDER_STEPS);
  // Leagues hold three milestones each; avoid a league with a single one.
  for (let extra = 1; goals.length % 3 === 1 && pace && extra <= 3; extra++) goals = build(LADDER_STEPS + extra);
  return goals;
}
