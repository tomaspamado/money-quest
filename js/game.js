// Game rules. Pure, deterministic functions of the parsed workbook plus the saved local state.
// No timers, no hidden state: same inputs -> same outputs.
import { addMonthsKey, monthDiff } from './dates.js';
import { fmtEur, fmtPct, fmtMonths } from './format.js';

export const XP = { perScorePoint: 100, beatMarket: 50, savingsTarget: 50, emergencyReady: 100, challenge: 75 };
export const LEVEL_BASE = 300;
export const LEVEL_TITLES = [
  { from: 0, title: 'Rookie' }, { from: 2, title: 'Saver' }, { from: 4, title: 'Investor' },
  { from: 6, title: 'Strategist' }, { from: 8, title: 'Captain' }, { from: 10, title: 'Legend' },
];

/** Cumulative XP needed for level n: round(300 × n^1.5). Level 0 starts at 0 XP. */
export const xpForLevel = (n) => (n <= 0 ? 0 : Math.round(LEVEL_BASE * Math.pow(n, 1.5)));

export function levelFor(xp) {
  let n = 0;
  while (xpForLevel(n + 1) <= xp && n < 999) n++;
  const floor = xpForLevel(n), next = xpForLevel(n + 1);
  const title = [...LEVEL_TITLES].reverse().find((t) => n >= t.from).title;
  return { level: n, title, xp, floor, next, progress: next > floor ? (xp - floor) / (next - floor) : 1 };
}

const ratingMin = (ratings, name, fallback) => (ratings.find((r) => r.name.toLowerCase() === name.toLowerCase())?.min ?? fallback);

/** Thresholds the game uses, all read from the workbook's SETTINGS (with its own defaults). */
export function thresholds(settings) {
  const top = settings.ratings[settings.ratings.length - 1];
  return {
    savingsTarget: settings.rules.savingsRate.two,      // 2-pt savings rate threshold (target)
    savingsOnePt: settings.rules.savingsRate.one,       // 1-pt threshold (streak)
    emergencyMonths: settings.emergencyMonthsTarget,    // months of spending kept in the emergency fund
    desvioMax: settings.rules.desvio.two,
    buildingMin: ratingMin(settings.ratings, 'Building', 3),
    strongName: top?.name ?? 'Strong',
    strongMin: top?.min ?? 5,
    maxScore: 6,
    lookback: settings.lookback || 12,
  };
}

function spendingOf(data, m) {
  if (m.spending != null) return m.spending;
  const d = data.spend.months.find((x) => x.key === m.key);
  return d ? d.total : null;
}

/** Per-month facts used by XP, streaks and badges. */
export function monthFacts(data) {
  const T = thresholds(data.settings);
  const months = data.months;
  return months.map((m, i) => {
    const spend = spendingOf(data, m);
    // Trailing window (including this month) of months that have spending, within the lookback.
    const window = months.filter((x) => monthDiff(x.key, m.key) >= 0 && monthDiff(x.key, m.key) < T.lookback)
      .map((x) => spendingOf(data, x)).filter((v) => v != null);
    const avgWin = window.length ? window.reduce((a, b) => a + b, 0) / window.length : null;
    const prior = months.filter((x) => monthDiff(x.key, m.key) > 0 && monthDiff(x.key, m.key) <= T.lookback)
      .map((x) => spendingOf(data, x)).filter((v) => v != null);
    const avgPrior = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
    const prev = i > 0 ? months[i - 1] : null;
    const prevIsLastMonth = prev && monthDiff(prev.key, m.key) === 1;
    const desvio = data.dashboard.byMonth[m.key]?.desvio ?? null;
    const f = {
      key: m.key,
      score: m.score,
      beat: m.me != null && m.sp != null && m.me > m.sp,
      savingsTarget: m.savingsRate != null && m.savingsRate >= T.savingsTarget,
      savingsOnePt: m.savingsRate != null && m.savingsRate >= T.savingsOnePt,
      emergencyReady: m.emergMonths != null && m.emergMonths >= T.emergencyMonths,
      building: m.score != null && m.score >= T.buildingMin,
      spendOK: spend != null && avgWin != null && window.length >= 2 && spend <= avgWin,
      frugal: spend != null && avgPrior != null && prior.length >= 3 && spend <= 0.8 * avgPrior,
      strong: m.score != null && m.score >= T.strongMin,
      diversified: desvio != null && desvio <= T.desvioMax,
      comeback: !!(prevIsLastMonth && m.score != null && prev.score != null && m.score - prev.score >= 2),
      nw: m.nw, invested: m.invested, spend, avgWin, windowCount: window.length,
    };
    f.xp = (m.score ?? 0) * XP.perScorePoint + (f.beat ? XP.beatMarket : 0) + (f.savingsTarget ? XP.savingsTarget : 0) + (f.emergencyReady ? XP.emergencyReady : 0);
    return f;
  });
}

/** Run lengths of a boolean predicate over consecutive months (a gap in months breaks a run). */
export function streakOf(facts, pred) {
  let best = 0, run = 0, prevKey = null;
  const reachedAt = {};
  for (const f of facts) {
    const contiguous = prevKey == null || monthDiff(prevKey, f.key) === 1;
    run = pred(f) ? (contiguous ? run + 1 : 1) : 0;
    if (run > best) best = run;
    if (run && !reachedAt[run]) reachedAt[run] = f.key;
    prevKey = f.key;
  }
  return { current: run, best, reachedAt };
}

export function streaks(facts, T) {
  return [
    { id: 'saving', title: 'Saving', rule: `Savings rate at least ${fmtPct(T.savingsOnePt, 0)}`, ...streakOf(facts, (f) => f.savingsOnePt) },
    { id: 'score', title: 'Building or better', rule: `Score of ${T.buildingMin} or more out of 6`, ...streakOf(facts, (f) => f.building) },
    { id: 'market', title: 'Beating the market', rule: 'Your monthly change beats the S&P 500', ...streakOf(facts, (f) => f.beat) },
    { id: 'spend', title: 'Spending in check', rule: `Spending at or below your ${T.lookback}-month average`, ...streakOf(facts, (f) => f.spendOK) },
  ];
}

const firstKey = (facts, pred) => facts.find(pred)?.key ?? null;

/** Badge catalogue: every badge says its condition and shows progress while locked. */
export function badges(data, facts, T, ctx) {
  const last = facts[facts.length - 1] || {};
  const st = ctx.streaks;
  const bestStreak = Math.max(0, ...st.map((s) => s.best));
  const streakAt = (n) => st.map((s) => s.reachedAt[n]).filter(Boolean).sort()[0] ?? null;
  const beats = facts.filter((f) => f.beat).length;
  const doneChallenges = ctx.completedChallenges;
  const nwBadge = (amount, icon) => ({
    id: `nw-${amount / 1000}k`, icon, title: `${amount / 1000}k club`,
    condition: `Net worth reaches ${fmtEur(amount)}`,
    unlockedKey: firstKey(facts, (f) => f.nw != null && f.nw >= amount),
    progress: Math.min(1, (last.nw ?? 0) / amount), progressText: `${fmtEur(last.nw ?? 0)} of ${fmtEur(amount)}`,
  });
  const questBadge = (amount) => ({
    id: `quest-${amount / 1000}k`, icon: 'flag', title: `Quest: ${amount / 1000}k invested`,
    condition: `Invested assets reach ${fmtEur(amount)}`,
    unlockedKey: firstKey(facts, (f) => f.invested != null && f.invested >= amount),
    progress: Math.min(1, (last.invested ?? 0) / amount), progressText: `${fmtEur(last.invested ?? 0)} of ${fmtEur(amount)}`,
  });
  const list = [
    { id: 'first-upload', icon: 'upload', title: 'First upload', condition: 'Load your Excel file once',
      unlockedDate: ctx.firstUploadAt, progress: ctx.firstUploadAt ? 1 : 0, progressText: ctx.firstUploadAt ? 'Done' : 'Not yet' },
    { id: 'streak-3', icon: 'flame', title: 'Three in a row', condition: 'Any streak reaches 3 months',
      unlockedKey: streakAt(3), progress: Math.min(1, bestStreak / 3), progressText: `Best streak ${bestStreak} of 3 months` },
    { id: 'streak-6', icon: 'flame', title: 'Half a year', condition: 'Any streak reaches 6 months',
      unlockedKey: streakAt(6), progress: Math.min(1, bestStreak / 6), progressText: `Best streak ${bestStreak} of 6 months` },
    { id: 'beat-market', icon: 'trend', title: 'Beat the market', condition: 'A month where your change beats the S&P 500',
      unlockedKey: firstKey(facts, (f) => f.beat), progress: beats ? 1 : 0, progressText: `${beats} of 1 month` },
    { id: 'emergency-ready', icon: 'shield', title: 'Emergency ready', condition: `Emergency fund covers ${fmtMonths(T.emergencyMonths, 0)} of spending`,
      unlockedKey: firstKey(facts, (f) => f.emergencyReady),
      progress: Math.min(1, (data.months.at(-1)?.emergMonths ?? 0) / T.emergencyMonths),
      progressText: `${fmtMonths(data.months.at(-1)?.emergMonths ?? 0)} of ${fmtMonths(T.emergencyMonths, 0)}` },
    nwBadge(5000, 'coin'), nwBadge(10000, 'coin'), nwBadge(25000, 'coin'),
    { id: 'strong-month', icon: 'star', title: `${T.strongName} month`, condition: `Score of ${T.strongMin} or more (rating ${T.strongName})`,
      unlockedKey: firstKey(facts, (f) => f.strong), progress: Math.min(1, (last.score ?? 0) / T.strongMin), progressText: `Latest score ${last.score ?? '–'} of ${T.strongMin}` },
    { id: 'perfect-month', icon: 'star', title: 'Perfect month', condition: 'Score of 6 out of 6',
      unlockedKey: firstKey(facts, (f) => f.score === 6), progress: Math.min(1, (last.score ?? 0) / 6), progressText: `Latest score ${last.score ?? '–'} of 6` },
    { id: 'frugal', icon: 'leaf', title: 'Frugal month', condition: `Spending at least 20% below your average of the previous months (up to ${T.lookback}, at least 3)`,
      unlockedKey: firstKey(facts, (f) => f.frugal), progress: facts.some((f) => f.frugal) ? 1 : 0, progressText: 'Not yet' },
    { id: 'diversified', icon: 'target', title: 'On target', condition: `Allocation deviation at or below ${fmtPct(T.desvioMax, 0)} (Desvio)`,
      unlockedKey: firstKey(facts, (f) => f.diversified), progress: facts.some((f) => f.diversified) ? 1 : 0, progressText: 'Not yet' },
    { id: 'comeback', icon: 'bolt', title: 'Comeback', condition: 'Score up 2 or more points on the month before',
      unlockedKey: firstKey(facts, (f) => f.comeback), progress: facts.some((f) => f.comeback) ? 1 : 0, progressText: 'Not yet' },
    questBadge(25000), questBadge(50000),
    { id: 'challenger', icon: 'check', title: 'Challenger', condition: 'Complete 3 monthly challenges',
      unlockedDate: doneChallenges.length >= 3 ? doneChallenges[2].evaluatedAt : null,
      progress: Math.min(1, doneChallenges.length / 3), progressText: `${Math.min(doneChallenges.length, 3)} of 3 challenges` },
  ];
  for (const b of list) {
    b.unlocked = !!(b.unlockedKey || b.unlockedDate);
    if (b.unlocked) b.progress = 1;
  }
  return list;
}

// ---------------- Monthly challenges (a small state machine) ----------------
// state.challenges = { active: {forMonth, basedOn, items[]} | null, history: [{forMonth, evaluatedAt, items[]}] }
// Item status: 'active' -> 'completed' | 'failed' | 'no-data'.

export function generateChallenges(data) {
  const T = thresholds(data.settings);
  const latest = data.months.at(-1);
  if (!latest) return null;
  const forMonth = addMonthsKey(latest.key, 1);
  const items = [];
  // 1) The category with the highest average over the last 3 months of DESPESAS.
  const sm = data.spend.months.filter((m) => monthDiff(m.key, latest.key) >= 0 && monthDiff(m.key, latest.key) < 3);
  if (sm.length && data.spend.categories.length) {
    let best = null;
    for (const c of data.spend.categories) {
      const avg = sm.reduce((s, m) => s + (m.byCat[c] ?? 0), 0) / sm.length;
      if (avg > 0 && (!best || avg > best.avg)) best = { c, avg };
    }
    if (best) items.push({ id: 'cat-under', type: 'cat-under', cat: best.c, target: Math.round(best.avg),
      title: `Keep ${best.c} under ${fmtEur(Math.round(best.avg))}`, detail: `Your average for the last ${sm.length} month${sm.length > 1 ? 's' : ''}.` });
  }
  // 2) Savings rate at the workbook's target.
  items.push({ id: 'savings', type: 'savings', target: T.savingsTarget,
    title: `Savings rate of ${fmtPct(T.savingsTarget, 0)} or more`, detail: 'The 2-point level in your score rules.' });
  // 3) Emergency fund one month closer, or beat the market once it is full.
  if (latest.emergMonths != null && latest.emergMonths < T.emergencyMonths) {
    const target = Math.min(T.emergencyMonths, Math.floor(latest.emergMonths) + 1);
    items.push({ id: 'emergency', type: 'emergency', target, title: `Emergency fund at ${fmtMonths(target, 0)}`,
      detail: `Now ${fmtMonths(latest.emergMonths)}; the target is ${fmtMonths(T.emergencyMonths, 0)}.` });
  } else {
    items.push({ id: 'beat', type: 'beat', title: 'Beat the S&P 500', detail: 'Your monthly change beats the index.' });
  }
  if (items.length < 3) {
    const target = Math.min(6, Math.max(T.buildingMin, latest.score ?? 0));
    items.push({ id: 'score', type: 'score', target, title: `Score of ${target} or more`, detail: 'Out of 6, from your workbook.' });
  }
  return { forMonth, basedOn: latest.key, items: items.slice(0, 3).map((i) => ({ ...i, status: 'active', actual: null })) };
}

export function evaluateItem(item, data, key) {
  const m = data.months.find((x) => x.key === key);
  const s = data.spend.months.find((x) => x.key === key);
  let actual = null, ok = null;
  switch (item.type) {
    case 'cat-under': if (s) { actual = s.byCat[item.cat] ?? 0; ok = actual <= item.target; } break;
    case 'savings': if (m && m.savingsRate != null) { actual = m.savingsRate; ok = actual >= item.target; } break;
    case 'emergency': if (m && m.emergMonths != null) { actual = m.emergMonths; ok = actual >= item.target; } break;
    case 'beat': if (m && m.me != null && m.sp != null) { actual = m.me - m.sp; ok = m.me > m.sp; } break;
    case 'score': if (m && m.score != null) { actual = m.score; ok = actual >= item.target; } break;
  }
  return { ...item, actual, status: ok == null ? 'no-data' : ok ? 'completed' : 'failed' };
}

/**
 * Apply an upload to the challenge state. Pure: returns a new state and the events it caused.
 * - If the active challenges' month is now in the data: evaluate them and archive.
 * - If the data has moved past that month without it: archive as 'no-data'.
 * - Then, if nothing is active, generate three for the month after the latest one.
 */
export function applyUploadToChallenges(prev, data, nowISO) {
  const state = { active: prev?.active ?? null, history: [...(prev?.history ?? [])] };
  const events = [];
  const latest = data.months.at(-1)?.key;
  if (!latest) return { state, events };
  if (state.active) {
    const fm = state.active.forMonth;
    if (fm <= latest) {
      const has = data.months.some((m) => m.key === fm);
      const items = state.active.items.map((it) => (has ? evaluateItem(it, data, fm) : { ...it, status: 'no-data' }));
      state.history.unshift({ forMonth: fm, evaluatedAt: nowISO, items });
      for (const it of items) events.push({ type: 'challenge', status: it.status, title: it.title });
      state.active = null;
    }
  }
  if (!state.active) {
    const gen = generateChallenges(data);
    if (gen && !state.history.some((h) => h.forMonth === gen.forMonth)) {
      state.active = { ...gen, createdAt: nowISO };
      events.push({ type: 'new-challenges', forMonth: gen.forMonth });
    }
  }
  return { state, events };
}

export function completedChallenges(chState) {
  const out = [];
  for (const h of [...(chState?.history ?? [])].reverse()) for (const it of h.items) if (it.status === 'completed') out.push({ ...it, evaluatedAt: h.evaluatedAt, forMonth: h.forMonth });
  return out;
}

/** Everything the Rewards page needs, from data + saved state. */
export function computeGame(data, saved) {
  const T = thresholds(data.settings);
  const facts = monthFacts(data);
  const done = completedChallenges(saved.challenges);
  const monthXP = facts.reduce((s, f) => s + f.xp, 0);
  const challengeXP = done.length * XP.challenge;
  const total = monthXP + challengeXP;
  const st = streaks(facts, T);
  const bl = badges(data, facts, T, { streaks: st, completedChallenges: done, firstUploadAt: saved.meta?.firstUploadAt ?? null });
  return { T, facts, xp: { monthXP, challengeXP, total }, level: levelFor(total), streaks: st, badges: bl, completed: done };
}

/** Badge closest to unlocking (highest progress among locked), for the "next badge" hint. */
export function nextBadge(badgeList) {
  return badgeList.filter((b) => !b.unlocked).sort((a, b) => b.progress - a.progress)[0] ?? null;
}
