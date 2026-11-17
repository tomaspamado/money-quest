// Money Quest UI. Plain ES module, no build step. All data stays in this browser.
import { parseWorkbook, parseLooseNumber } from './parse.js';
import { labelKey, monthDiff } from './dates.js';
import { fmtEur, fmtEurSigned, fmtEurCompact, fmtPct, fmtSignedPct, fmtNumber, fmtYears, fmtMonths, fmtXP } from './format.js';
import { computeGame, applyUploadToChallenges, nextBadge, XP, xpForLevel, LEVEL_TITLES } from './game.js';
import { yearsToGoal, dateAfterYears, ageAtKey, costOfWaiting, milestoneGoals, LADDER_START } from './projection.js';
import { lineChart, stackedBars, sparkline, bindCharts, dataTable } from './charts.js';
import { icon } from './icons.js';
import { loadData, loadSaved, saveAll, resetAll, emptySaved } from './store.js';

const XLSX = window.XLSX;
const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'wealth', label: 'Wealth', icon: 'wealth' },
  { id: 'allocation', label: 'Allocation', icon: 'allocation' },
  { id: 'spend', label: 'Spend', icon: 'spend' },
  { id: 'quest', label: 'Quest', icon: 'quest' },
];
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const GROUP_NAMES = ['Investments', 'Emergency', 'Lifestyle', 'Fun Money', 'Other'];
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- State ----------------
const S = {
  data: loadData(),
  saved: loadSaved(),
  game: null,
  tab: 'home',
  sub: { wealth: 'nw', spend: 'spending', quest: 'map' },
  subScroll: {},
  month: { wealth: null, allocation: null },
  whatIf: null,             // {monthly, annual} while the user tries other numbers
  open: new Set(),          // open accordions
  layers: [],               // stack of open layers {kind, arg, el, from}
  resetArmed: false,
  animate: true,
};
if (S.data && S.data.parserVersion == null) S.data = null;
const recompute = () => { S.game = S.data && S.data.months.length ? computeGame(S.data, S.saved) : null; };
recompute();

const latest = () => S.data?.months.at(-1) ?? null;
const monthAt = (key) => S.data?.months.find((m) => m.key === key) ?? null;
const keys = () => S.data?.months.map((m) => m.key) ?? [];

// ---------------- Small building blocks ----------------
function delta(value, { fmt = fmtEurSigned, rest = '', goodWhenUp = true } = {}) {
  if (value == null || !isFinite(value)) return '';
  const flat = Math.abs(value) < 1e-9;
  const up = value > 0;
  const cls = flat ? 'flat' : (up === goodWhenUp ? 'up' : 'down');
  const word = flat ? 'No change' : up ? 'Up' : 'Down';
  return `<span class="delta ${cls}">${icon(flat ? 'minusCircle' : up ? 'up' : 'down', 16)}<span>${word} ${esc((fmt === fmtEurSigned ? fmtEur : fmt)(Math.abs(value)))}</span>${rest ? `<span class="rest">${esc(rest)}</span>` : ''}</span>`;
}
const status = (kind, word, ico) => `<span class="status ${kind}">${icon(ico || { good: 'checkCircle', attention: 'alert', info: 'info', critical: 'xCircle' }[kind], 18)}<span>${esc(word)}</span></span>`;

function accordion(id, title, body) {
  const open = S.open.has(id);
  return `<div class="acc">
    <button class="acc-btn" data-act="acc" data-id="${esc(id)}" aria-expanded="${open}" aria-controls="acc-${esc(id)}"><span>${esc(title)}</span>${icon('chevronD', 20)}</button>
    <div class="acc-body${open ? ' open' : ''}" id="acc-${esc(id)}"><div><div class="acc-content">${body}</div></div></div>
  </div>`;
}
function seg(page, options) {
  return `<div class="seg" role="tablist" aria-label="View">${options.map(([v, l]) => `<button role="tab" data-act="sub" data-page="${page}" data-v="${v}" aria-selected="${S.sub[page] === v}">${esc(l)}</button>`).join('')}</div>`;
}
function meter(frac, { mark = null, reward = false, label = '' } = {}) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const m = mark == null ? '' : `<span class="mark" style="left:${(Math.max(0, Math.min(1, mark)) * 100).toFixed(1)}%"></span>`;
  return `<div class="meter${reward ? ' reward' : ''}${S.animate ? ' grow-in' : ''}" role="img" aria-label="${esc(label)}"><span class="fill" style="width:${(f * 100).toFixed(1)}%"></span>${m}</div>`;
}
function stepper(page) {
  const ks = keys();
  const cur = S.month[page] && ks.includes(S.month[page]) ? S.month[page] : ks.at(-1);
  const i = ks.indexOf(cur);
  return `<div class="stepper panel" style="padding:4px">
    <button class="icon-btn" data-act="month" data-page="${page}" data-d="-1" aria-label="Previous month" ${i <= 0 ? 'data-edge="1"' : ''}>${icon('chevronL', 22)}</button>
    <span class="when">${esc(labelKey(cur, 'long'))}</span>
    <button class="icon-btn" data-act="month" data-page="${page}" data-d="1" aria-label="Next month" ${i >= ks.length - 1 ? 'data-edge="1"' : ''}>${icon('chevronR', 22)}</button>
  </div>`;
}
const pageMonth = (page) => { const ks = keys(); return S.month[page] && ks.includes(S.month[page]) ? S.month[page] : ks.at(-1); };

function chartWidth() {
  const view = document.querySelector('.view');
  const pad = view ? parseFloat(getComputedStyle(view).paddingLeft) * 2 : 32;
  return Math.min(560, window.innerWidth - pad) - 34;
}
function legend(items, kind = 'rect') {
  return `<div class="legend">${items.map((it) => `<span>${kind === 'line' ? `<i class="line-key" style="background:${it.color}"></i>` : `<i class="swatch" style="background:${it.color}"></i>`}${esc(it.name)}</span>`).join('')}</div>`;
}
function emptyState(title = 'Choose your Excel file to start') {
  return `<div class="panel summary stack">
    <h2>${esc(title)}</h2>
    <p class="muted small">Money Quest reads the workbook on this phone. Nothing is uploaded.</p>
    <button class="btn primary block" data-act="upload">${icon('upload', 20)}Choose Excel file</button>
  </div>`;
}

// Level badge: solid shield with level number, thin XP ring around it.
function levelBadge(lv, size = 96) {
  const r = 44, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, lv.progress));
  return `<div class="level-badge" style="width:${size}px;height:${size}px" role="img" aria-label="Level ${lv.level}, ${Math.round(frac * 100)}% of the way to level ${lv.level + 1}">
    <svg viewBox="0 0 96 96" width="${size}" height="${size}" aria-hidden="true">
      <circle class="xp-track" cx="48" cy="48" r="${r}" fill="none" stroke-width="3"/>
      <circle class="xp-fill" cx="48" cy="48" r="${r}" fill="none" stroke-width="3" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 48 48)"/>
      <path class="shield-solid" d="M48 20 28 27v14c0 13 8.6 23 20 28 11.4-5 20-15 20-28V27z"/>
    </svg>
    <span class="level-num" style="font-size:${size > 80 ? 28 : 20}px">${lv.level}</span>
  </div>`;
}
function scoreRing(score, size = 84) {
  const r = 34, c = 2 * Math.PI * r, f = score == null ? 0 : score / 6;
  return `<svg width="${size}" height="${size}" viewBox="0 0 84 84" role="img" aria-label="Score ${score ?? 'not available'} out of 6">
    <circle class="ring-track" cx="42" cy="42" r="${r}" fill="none" stroke-width="7"/>
    <circle class="ring-fill" cx="42" cy="42" r="${r}" fill="none" stroke-width="7" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 42 42)"/>
    <text class="ring-text" x="42" y="47" text-anchor="middle" font-size="22">${score ?? '–'}</text>
    <text x="42" y="62" text-anchor="middle" font-size="10" style="fill:var(--ink-2)">of 6</text>
  </svg>`;
}
function bestCurrentStreak() {
  const st = S.game.streaks.filter((s) => s.current > 0).sort((a, b) => b.current - a.current)[0];
  return st || null;
}

// ---------------- Views ----------------
function viewHome() {
  if (!S.data) {
    return `<div class="onboard">
      <img class="mark" src="icons/icon.svg" alt="">
      <div class="stack"><h1>Money Quest</h1><p class="muted">Your finance workbook, as a game you can win month by month.</p></div>
      <ul>
        <li>${icon('privacy', 20)}<span>Your Excel file is read on this phone. It is never uploaded, and the app makes no network requests with your data.</span></li>
        <li>${icon('upload', 20)}<span>Each month, export the workbook and load it again here. Progress, badges and challenges are kept on this device.</span></li>
        <li>${icon('trash', 20)}<span>You can erase everything at any time from More.</span></li>
      </ul>
      <button class="btn primary block" data-act="upload">${icon('upload', 20)}Choose your Excel file to start</button>
    </div>`;
  }
  const L = latest(), prev = S.data.months.at(-2), G = S.game, lv = G.level;
  const diff = prev && monthDiff(prev.key, L.key) === 1 ? L.nw - prev.nw : null;
  const streak = bestCurrentStreak();
  const nb = nextBadge(G.badges);
  const ch = S.saved.challenges.active;
  const res = S.saved.lastResult;
  const pts = [['Savings rate', L.savPts], ['Emergency fund', L.emergPts], ['Allocation', L.allocPts]];
  const resultLine = res && (res.xpGained > 0 || res.newBadges.length)
    ? `<button class="tap panel" data-act="layer" data-kind="result" aria-label="What changed with the last upload">
        <div class="row between"><div class="stack" style="gap:2px"><span class="label">Since your last upload</span>
        <span>${res.xpGained > 0 ? `<b class="num">+${esc(fmtXP(res.xpGained))}</b>` : ''}${res.newBadges.length ? ` and ${res.newBadges.length} new badge${res.newBadges.length > 1 ? 's' : ''}` : ''}</span></div>${icon('chevronR', 18)}</div></button>` : '';
  return `<div class="view-inner">
    <div class="topbar"><h1>Money Quest</h1><button class="icon-btn" data-act="layer" data-kind="more" aria-label="More: settings, help and data">${icon('more', 24)}</button></div>

    <section class="panel summary" aria-label="This month">
      <span class="label">Net worth, ${esc(labelKey(L.key, 'long'))}</span>
      <div class="hero">${esc(fmtEur(L.nw))}</div>
      ${diff != null ? delta(diff, { rest: `on ${labelKey(prev.key, 'long')}` }) : '<span class="tiny">First month in your file</span>'}
      <div class="score" style="margin-top:var(--sp-5)">
        ${scoreRing(L.score)}
        <div class="grow stack" style="gap:6px">
          <div><span class="label">Score this month</span><h2 style="margin:0">${esc(L.rating ?? 'No score yet')}</h2></div>
          <div class="pts">${pts.map(([n, v]) => `<span class="muted">${n}</span><span class="num">${v ?? '–'} of 2</span>`).join('')}</div>
        </div>
      </div>
    </section>

    <button class="tap panel" data-act="goto" data-tab="quest" data-sub="rewards" aria-label="Open rewards: level, streaks and badges">
      <div class="level-hero">
        ${levelBadge(lv, 76)}
        <div class="grow stack" style="gap:6px">
          <div class="row between"><h2 style="margin:0">Level ${lv.level}, ${esc(lv.title)}</h2>${icon('chevronR', 18)}</div>
          ${meter(lv.progress, { reward: true, label: `${fmtXP(lv.xp - lv.floor)} of ${fmtXP(lv.next - lv.floor)} to level ${lv.level + 1}` })}
          <span class="tiny">${esc(fmtXP(lv.next - lv.xp))} to level ${lv.level + 1}</span>
        </div>
      </div>
      <div class="row" style="margin-top:var(--sp-4);gap:var(--sp-2)">
        <span style="color:var(--reward)">${icon('flame', 22)}</span>
        <span class="small">${streak ? `<b class="num">${streak.current}</b>-month streak: ${esc(streak.title.toLowerCase())}` : 'No streak running. One good month starts one.'}</span>
      </div>
      ${ch ? `<div class="row" style="margin-top:var(--sp-2);gap:var(--sp-2)"><span style="color:var(--reward)">${icon('target', 22)}</span><span class="small">${ch.items.length} challenges for ${esc(labelKey(ch.forMonth, 'long'))}, worth ${XP.challenge} XP each</span></div>` : ''}
    </button>

    ${nb ? `<button class="tap panel" data-act="layer" data-kind="badge" data-arg="${esc(nb.id)}" aria-label="Next badge: ${esc(nb.title)}">
      <div class="row"><div class="badge-ico" style="border:1.5px dashed var(--hairline-strong);color:var(--ink-2)">${icon(nb.icon, 24)}</div>
      <div class="grow stack" style="gap:4px"><span class="label">Closest badge</span><b>${esc(nb.title)}</b>${meter(nb.progress, { reward: true, label: nb.progressText })}<span class="tiny">${esc(nb.progressText)}</span></div></div>
    </button>` : ''}

    ${resultLine}

    <button class="btn primary block" data-act="upload">${icon('upload', 20)}Update from Excel</button>
    <p class="tiny" style="text-align:center">Last loaded ${esc(fmtDateTime(S.saved.meta.lastUploadAt))}. Latest month in the file: ${esc(labelKey(L.key, 'long'))}.</p>

    <div class="panel" style="padding-top:0;padding-bottom:0">
      ${accordion('home-score', 'How the score works', `
        <p class="small muted">The score comes straight from your workbook (0 to 6). Each part gives 0, 1 or 2 points.</p>
        <div class="pts">
          <span class="muted">Savings rate</span><span class="num">2 at ${esc(fmtPct(S.data.settings.rules.savingsRate.two, 0))}, 1 at ${esc(fmtPct(S.data.settings.rules.savingsRate.one, 0))}</span>
          <span class="muted">Emergency fund</span><span class="num">2 at ${esc(fmtNumber(S.data.settings.rules.emergency.two, 0))}, 1 at ${esc(fmtNumber(S.data.settings.rules.emergency.one, 0))} months</span>
          <span class="muted">Allocation deviation</span><span class="num">2 at ${esc(fmtPct(S.data.settings.rules.desvio.two, 0))}, 1 at ${esc(fmtPct(S.data.settings.rules.desvio.one, 0))}</span>
        </div>
        <p class="small muted">Ratings: ${S.data.settings.ratings.map((r) => `${esc(r.name)} from ${r.min}`).join(', ')}.</p>
        <button class="btn small" data-act="layer" data-kind="points">How points and levels work</button>`)}
    </div>
  </div>`;
}

function fmtDateTime(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  return `${d.getDate()} ${labelKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)}`;
}

function viewWealth() {
  if (!S.data) return `<div class="view-inner"><div class="topbar"><h1>Wealth</h1></div>${emptyState()}</div>`;
  const ms = S.data.months, L = latest(), F = ms[0];
  const ks = keys(), w = chartWidth();
  const nwBadge = S.game.badges.filter((b) => b.id.startsWith('nw-') && !b.unlocked)[0];
  let chart = '';
  if (S.sub.wealth === 'nw') {
    const series = [{ name: 'Net worth', values: ms.map((m) => m.nw), color: 'var(--s1)' }];
    chart = `<h2>Net worth by month</h2>
      ${lineChart({ id: 'nw', keys: ks, series, w, fmt: (v) => fmtEur(v), axisFmt: fmtEurCompact, area: true, zero: true, title: 'Net worth by month' })}
      ${accordion('wealth-nw-table', 'Show as table', dataTable({ keys: ks, series, fmt: (v) => fmtEur(v) }))}`;
  } else {
    const idx = (getter) => { let v = 100; return ms.map((m, i) => { const r = getter(m); if (i === 0) return 100; if (r == null) return null; v = v * (1 + r); return v; }); };
    const series = [
      { name: 'Your investments', values: idx((m) => m.ret), color: 'var(--s1)' },
      { name: 'S&P 500', values: idx((m) => m.sp), color: 'var(--s2)' },
    ];
    const beats = ms.filter((m) => m.ret != null && m.sp != null && m.ret > m.sp).length;
    const comparable = ms.filter((m) => m.ret != null && m.sp != null).length;
    chart = `<h2>You against the S&P 500</h2>
      <p class="small muted" style="margin-bottom:var(--sp-3)">Both start at 100 in ${esc(labelKey(F.key))}. Your line is the return of Trading212, Stake and Robinhood only, without the money you added that month (the "→ Invest" value in BASE). You beat the index in ${beats} of ${comparable} months${comparable < ms.length - 1 ? `; months without a "→ Invest" value are left out` : ''}.</p>
      ${lineChart({ id: 'vs', keys: ks, series, w, fmt: (v) => fmtNumber(v, 1), axisFmt: (v) => fmtNumber(v, 0), title: 'Growth index, you against the S&P 500', endLabel: false })}
      ${legend(series, 'line')}
      ${accordion('wealth-vs-table', 'Show monthly changes', dataTable({ keys: ks, series: [{ name: 'Your investments', values: ms.map((m) => m.ret) }, { name: 'S&P 500', values: ms.map((m) => m.sp) }], fmt: (v) => fmtSignedPct(v) }))}`;
  }
  const mk = pageMonth('wealth'), m = monthAt(mk);
  const groups = GROUP_NAMES.map((g, i) => ({ name: g, value: m.groups[g] ?? 0, color: SERIES[i] })).filter((g) => g.value > 0.005);
  const total = groups.reduce((s, g) => s + g.value, 0) || 1;
  const segBar = `<div class="row" style="gap:2px;height:28px;margin:var(--sp-3) 0 0" role="img" aria-label="${esc(groups.map((g) => `${g.name} ${fmtPct(g.value / total, 0)}`).join(', '))}">
    ${groups.map((g) => { const f = g.value / total; return `<span style="flex:${f.toFixed(4)} 1 0;min-width:2px;height:28px;border-radius:4px;background:${g.color};color:#fff;font-size:12px;display:flex;align-items:center;padding-left:6px;overflow:hidden">${f > 0.12 ? esc(fmtPct(f, 0)) : ''}</span>`; }).join('')}</div>`;
  const accRows = S.data.accountNames.map((a) => ({ a, v: m.accounts[a] ?? 0 })).sort((x, y) => y.v - x.v);
  return `<div class="view-inner">
    <div class="topbar"><h1>Wealth</h1></div>
    <section class="panel summary">
      <span class="label">Net worth, ${esc(labelKey(L.key, 'long'))}</span>
      <div class="hero">${esc(fmtEur(L.nw))}</div>
      ${ms.length > 1 ? delta(L.nw - F.nw, { rest: `since ${labelKey(F.key)} (${ms.length} months)` }) : ''}
      ${nwBadge ? `<button class="tap row" style="margin-top:var(--sp-4);min-height:44px" data-act="layer" data-kind="badge" data-arg="${esc(nwBadge.id)}"><span style="color:var(--reward)">${icon('coin', 20)}</span><span class="grow stack" style="gap:4px"><span class="small">Next badge: ${esc(nwBadge.title)}</span>${meter(nwBadge.progress, { reward: true, label: nwBadge.progressText })}</span>${icon('chevronR', 18)}</button>` : ''}
    </section>
    ${seg('wealth', [['nw', 'Net worth'], ['vs', 'You vs S&P 500']])}
    <section class="panel">${chart}</section>
    ${stepper('wealth')}
    <section class="panel">
      <div class="panel-head"><h2>Where it sits</h2><span class="num">${esc(fmtEur(m.nw))}</span></div>
      ${segBar}
      ${legend(groups)}
      <div class="list" style="margin-top:var(--sp-3)">
        ${accRows.map(({ a, v }) => `<button class="tap li" data-act="layer" data-kind="account" data-arg="${esc(a)}" aria-label="${esc(a)}, ${esc(fmtEur(v))}">
          <span class="grow"><span class="name">${esc(a)}</span><span class="sub">${esc(fmtPct(m.nw ? v / m.nw : 0, 1))} of net worth</span></span>
          ${sparkline(S.data.months.map((x) => x.accounts[a] ?? null))}
          <span class="val"><span class="num">${esc(fmtEur(v))}</span></span>${icon('chevronR', 18).replace('class="ico"', 'class="ico chev"')}
        </button>`).join('')}
      </div>
    </section>
  </div>`;
}

function allocationFor(key) {
  const m = monthAt(key), d = S.data.dashboard.byMonth[key] || {}, st = S.data.settings;
  const nw = m?.nw ?? 0;
  const share = (g) => (nw ? (m.groups[g] ?? 0) / nw : null);
  // Emergency target share depends on the month's net worth (SETTINGS: target € / net worth).
  const emT = key === latest().key && st.targets.Emergency != null ? st.targets.Emergency : (st.emergencyTargetEur && nw ? st.emergencyTargetEur / nw : st.targets.Emergency);
  return [
    { name: 'Investments', actual: d.investments ?? share('Investments'), target: st.targets.Investments },
    { name: 'Emergency', actual: d.emergency ?? share('Emergency'), target: emT },
    { name: 'Lifestyle', actual: d.lifestyle ?? share('Lifestyle'), target: st.targets.Lifestyle },
    { name: 'Fun Money', actual: d.fun ?? share('Fun Money'), target: st.targets['Fun Money'] },
  ].map((r) => ({ ...r, gap: r.target != null && r.actual != null ? r.target - r.actual : null, gapEur: r.target != null && r.actual != null ? (r.target - r.actual) * nw : null }));
}

function viewAllocation() {
  if (!S.data) return `<div class="view-inner"><div class="topbar"><h1>Allocation</h1></div>${emptyState()}</div>`;
  const key = pageMonth('allocation'), m = monthAt(key), st = S.data.settings, T = S.game.T;
  const d = S.data.dashboard.byMonth[key] || {};
  const rows = allocationFor(key);
  const dev = d.desvio;
  const devStatus = dev == null ? status('info', 'No deviation figure for this month') : dev <= st.rules.desvio.two ? status('good', 'On target') : dev <= st.rules.desvio.one ? status('attention', 'Close to target') : status('critical', 'Off target');
  const em = m.emergMonths, emT = T.emergencyMonths;
  const emBadge = S.game.badges.find((b) => b.id === 'emergency-ready');
  const emEur = m.groups.Emergency ?? 0, emTargetEur = st.emergencyTargetEur;
  const split = S.data.income.split?.[key];
  const moves = rows.filter((r) => r.gapEur != null && Math.abs(r.gapEur) >= 1);
  return `<div class="view-inner">
    <div class="topbar"><h1>Allocation</h1></div>
    ${stepper('allocation')}
    <section class="panel summary stack">
      <span class="label">Is your money where you want it?</span>
      ${devStatus}
      <div class="row wrap" style="gap:var(--sp-4) var(--sp-5);margin-top:var(--sp-2);align-items:flex-start">
        <div class="grow" style="min-width:120px"><div class="big">${esc(fmtPct(dev, 1))}</div><span class="tiny">Deviation, best at ${esc(fmtPct(st.rules.desvio.two, 0))} or less</span></div>
        <div class="grow" style="min-width:120px"><div class="big">${esc(fmtNumber(em, 1))}</div><span class="tiny">Emergency months, target ${esc(fmtNumber(emT, 0))}</span></div>
      </div>
      <p class="tiny">Allocation points this month: ${m.allocPts ?? '–'} of 2.</p>
    </section>

    <section class="panel">
      <h2>Actual against target</h2>
      ${rows.map((r) => `<div class="alloc-row">
        <div class="row between"><span>${esc(r.name)}</span><span class="num">${esc(fmtPct(r.actual, 1))}</span></div>
        ${meter(r.actual, { mark: r.target, label: `${r.name}: ${fmtPct(r.actual, 1)}, target ${fmtPct(r.target, 0)}` })}
        <div class="row between tiny"><span>Target ${esc(fmtPct(r.target, r.target != null && Math.abs(r.target * 100 - Math.round(r.target * 100)) > 0.05 ? 1 : 0))}</span>
        <span>${r.gap == null ? '' : Math.abs(r.gap) < 0.0005 ? 'On target' : `${esc(fmtNumber(Math.abs(r.gap) * 100, 1))} pts ${r.gap > 0 ? 'below' : 'above'}`}</span></div>
      </div>`).join('')}
      <p class="tiny" style="margin-top:var(--sp-2)">The white tick on each bar marks the target. Liquidity ratio this month: ${esc(fmtPct(d.liquidity, 1))}.</p>
    </section>

    <section class="panel stack">
      <div class="panel-head" style="margin:0"><h2>Emergency fund</h2>${em != null && em >= emT ? status('good', 'Ready') : status('attention', 'Not full yet')}</div>
      ${meter(em != null ? em / emT : 0, { label: `${fmtMonths(em)} of ${fmtMonths(emT, 0)}` })}
      <div class="row between small"><span class="muted">${esc(fmtEur(emEur))} in NI T212</span><span class="muted">${emTargetEur ? `target ~${esc(fmtEur(emTargetEur))}` : ''}</span></div>
      ${emBadge && !emBadge.unlocked ? `<button class="tap row" style="min-height:44px" data-act="layer" data-kind="badge" data-arg="emergency-ready"><span style="color:var(--reward)">${icon('shield', 20)}</span><span class="grow small">Badge waiting: ${esc(emBadge.title)}</span>${icon('chevronR', 18)}</button>` : ''}
    </section>

    <div class="panel" style="padding-top:0;padding-bottom:0">
      ${accordion('alloc-moves', 'What it would take to hit the targets', `
        <p class="small muted">Plain arithmetic: (target share minus actual share) times net worth of ${esc(fmtEur(m.nw))}. Not financial advice.</p>
        <div class="list">${moves.length ? moves.map((r) => `<div class="li"><span class="grow">${esc(r.name)}</span><span class="val small">${r.gapEur > 0 ? `~${esc(fmtEur(r.gapEur))} short` : `~${esc(fmtEur(-r.gapEur))} over`}</span></div>`).join('') : '<p class="small">Every bucket is on target.</p>'}</div>`)}
      ${split ? accordion('alloc-split', 'Your workbook’s split for this month', `
        <p class="small muted">From the helper area in BASE: money available above your buffer and where the workbook suggests it goes.</p>
        <div class="list">${[['Available', split.available], ['To investments', split.invest], ['To emergency fund', split.emergency], ['Lifestyle', split.lifestyle], ['Fun money', split.fun]].filter(([, v]) => v != null).map(([n, v]) => `<div class="li"><span class="grow">${n}</span><span class="val num">${esc(fmtEur(v))}</span></div>`).join('')}</div>`) : ''}
    </div>
  </div>`;
}

function avgOf(list) { return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null; }

function viewSpend() {
  if (!S.data) return `<div class="view-inner"><div class="topbar"><h1>Spend</h1></div>${emptyState()}</div>`;
  const w = chartWidth();
  const lookback = S.data.settings.lookback || 12;
  let body = '';
  if (S.sub.spend === 'spending') {
    const sm = S.data.spend.months, cats = S.data.spend.categories;
    if (!sm.length) body = `<section class="panel"><p class="muted">No rows found in the DESPESAS sheet. Add monthly spending there and load the file again.</p></section>`;
    else {
      const last = sm.at(-1);
      const prior = sm.filter((m) => monthDiff(m.key, last.key) > 0 && monthDiff(m.key, last.key) <= lookback);
      const avg = avgOf(prior.map((m) => m.total));
      const ks = sm.map((m) => m.key);
      const series = cats.map((c, i) => ({ name: c, values: sm.map((m) => m.byCat[c] ?? 0), color: SERIES[i % 8] }));
      const recent = sm.filter((m) => monthDiff(m.key, last.key) > 0 && monthDiff(m.key, last.key) <= 3);
      const active = S.saved.challenges.active?.items.find((i) => i.type === 'cat-under');
      body = `<section class="panel summary">
          <span class="label">Spending in ${esc(labelKey(last.key, 'long'))}</span>
          <div class="hero">${esc(fmtEur(last.total))}</div>
          ${avg != null ? delta(last.total - avg, { goodWhenUp: false, rest: `on your average of the previous ${prior.length} month${prior.length > 1 ? 's' : ''} (~${fmtEur(avg)})` }) : '<span class="tiny">First month of spending in your file</span>'}
        </section>
        <section class="panel">
          <h2>Spending by category</h2>
          ${stackedBars({ id: 'spend', keys: ks, series, w, fmt: (v) => fmtEur(v), axisFmt: fmtEurCompact, title: 'Spending by category per month', totals: sm.map((m) => m.total) })}
          ${legend(series)}
          ${accordion('spend-table', 'Show as table', dataTable({ keys: ks, series, fmt: (v) => fmtEur(v), totals: sm.map((m) => m.total) }))}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Categories</h2><span class="tiny">${esc(labelKey(last.key))} against the ${recent.length} months before</span></div>
          <div class="list">${cats.map((c, i) => {
            const v = last.byCat[c] ?? 0, a = avgOf(recent.map((m) => m.byCat[c] ?? 0));
            const isCh = active && active.cat === c;
            return `<button class="tap li" data-act="layer" data-kind="category" data-arg="${esc(c)}" aria-label="${esc(c)}">
              <span class="swatch" style="background:${SERIES[i % 8]}"></span>
              <span class="grow"><span class="name">${esc(c)}</span><span class="sub">${a != null ? `Average ~${esc(fmtEur(a))}` : 'No earlier months'}${isCh ? `. Challenge: under ${esc(fmtEur(active.target))}` : ''}</span></span>
              <span class="val"><span class="num">${esc(fmtEur(v))}</span><br>${a != null && recent.length ? `<span class="tiny">${v > a ? 'Above' : v < a ? 'Below' : 'Same'}</span>` : ''}</span>${icon('chevronR', 18).replace('class="ico"', 'class="ico chev"')}
            </button>`;
          }).join('')}</div>
        </section>`;
    }
  } else {
    const im = S.data.income.months, srcs = S.data.income.sources;
    if (!im.length) body = `<section class="panel"><p class="muted">No rows found in the BASE sheet. Add monthly income there and load the file again.</p></section>`;
    else {
      const last = im.at(-1);
      const prior = im.filter((m) => monthDiff(m.key, last.key) > 0 && monthDiff(m.key, last.key) <= lookback);
      const avg = avgOf(prior.map((m) => m.total));
      const shown = im.filter((m) => monthDiff(m.key, last.key) < 24);
      const ks = shown.map((m) => m.key);
      const series = srcs.map((s, i) => ({ name: s, values: shown.map((m) => m.bySource[s] ?? 0), color: SERIES[i % 8] }));
      const win = im.filter((m) => monthDiff(m.key, last.key) >= 0 && monthDiff(m.key, last.key) < lookback);
      const winTotal = win.reduce((s, m) => s + m.total, 0);
      body = `<section class="panel summary">
          <span class="label">Income in ${esc(labelKey(last.key, 'long'))}</span>
          <div class="hero">${esc(fmtEur(last.total))}</div>
          ${avg != null ? delta(last.total - avg, { rest: `on your average of the previous ${prior.length} month${prior.length > 1 ? 's' : ''} (~${fmtEur(avg)})` }) : ''}
        </section>
        <section class="panel">
          <h2>Income by source</h2>
          ${stackedBars({ id: 'income', keys: ks, series, w, fmt: (v) => fmtEur(v), axisFmt: fmtEurCompact, title: 'Income by source per month', totals: shown.map((m) => m.total) })}
          ${legend(series)}
          ${accordion('income-table', 'Show as table', dataTable({ keys: ks, series, fmt: (v) => fmtEur(v), totals: shown.map((m) => m.total) }))}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Sources</h2><span class="tiny">Last ${win.length} months</span></div>
          <div class="list">${srcs.map((s, i) => ({ s, i, v: win.reduce((a, m) => a + (m.bySource[s] ?? 0), 0) })).sort((a, b) => b.v - a.v).map(({ s, i, v }) => `
            <div class="li"><span class="swatch" style="background:${SERIES[i % 8]}"></span><span class="grow"><span class="name">${esc(s)}</span><span class="sub">${esc(fmtPct(winTotal ? v / winTotal : 0, 0))} of income</span></span><span class="val num">${esc(fmtEur(v))}</span></div>`).join('')}
            <div class="li"><span class="grow"><b>Total</b></span><span class="val num">${esc(fmtEur(winTotal))}</span></div>
          </div>
        </section>`;
    }
  }
  return `<div class="view-inner"><div class="topbar"><h1>Spend</h1></div>${seg('spend', [['spending', 'Spending'], ['income', 'Income']])}<div class="stack sub-body" style="gap:var(--sp-4)">${body}</div></div>`;
}

// ---- Quest ----
function projInputs() {
  const P = S.data.settings.projection;
  return {
    pv: latest().nw ?? 0,   // the quest is on net worth
    monthly: S.whatIf?.monthly ?? P.monthly ?? 0,
    annual: S.whatIf?.annual ?? P.annualReturn ?? 0.07,
    horizon: P.years ?? 30,
    goal: P.goal ?? 100000,
    birth: P.birth,
  };
}
const P_IS_NW = false;   // the workbook's Milestones table projects invested money; the map projects net worth
function questNodes() {
  const I = projInputs(), excel = S.data.dashboard.milestones;
  return milestoneGoals(excel).map((goal) => {
    const ex = excel.find((m) => m.goal === goal);
    let years, when, age, source;
    // The Excel's own years and dates are worked out from invested money, so they are used only when they agree with net worth.
    if (!S.whatIf && ex && ex.years != null && P_IS_NW) {
      years = ex.years; when = ex.date ? `${ex.date.y}-${String(ex.date.m).padStart(2, '0')}` : dateAfterYears(years); age = ex.age ?? ageAtKey(I.birth, when); source = 'excel';
    } else {
      years = yearsToGoal({ goal, pv: I.pv, monthly: I.monthly, annual: I.annual }); when = dateAfterYears(years); age = ageAtKey(I.birth, when); source = 'app';
    }
    // The first milestone is the starting line of the quest, so it counts as reached; progress starts from there.
    return { goal, years, when, age, source, start: goal <= LADDER_START, reached: goal <= LADDER_START || I.pv >= goal };
  });
}
function viewQuest() {
  if (!S.data) return `<div class="view-inner"><div class="topbar"><h1>Quest</h1></div>${emptyState()}</div>`;
  const body = S.sub.quest === 'map' ? questMap() : rewards();
  return `<div class="view-inner"><div class="topbar"><h1>Quest</h1></div>${seg('quest', [['map', 'Map'], ['rewards', 'Rewards']])}<div class="stack sub-body" style="gap:var(--sp-4)">${body}</div></div>`;
}
/** Progress inside the current step: from the milestone before it to this one (never from zero). */
function stepProgress(nodes, i, pv) {
  const from = nodes[i - 1]?.goal ?? 0, to = nodes[i].goal;
  return Math.max(0, Math.min(1, (pv - from) / (to - from)));
}
function questMap() {
  const I = projInputs(), nodes = questNodes();
  const cur = nodes.findIndex((n) => !n.reached);
  const next = nodes[cur];
  const P = S.data.settings.projection;
  const w = chartWidth();
  const leagues = [];
  for (let i = 0; i < nodes.length; i += 3) leagues.push(nodes.slice(i, i + 3).map((n, j) => ({ ...n, i: i + j })));
  const nodeH = 92;
  const cow = S.whatIf || !P_IS_NW || !S.data.settings.costOfWaiting.length
    ? costOfWaiting({ pv: I.pv, monthly: I.monthly, annual: I.annual, horizon: I.horizon })
    : S.data.settings.costOfWaiting.filter((r) => r.delay > 0);
  const extra = S.whatIf || !P_IS_NW || !S.data.settings.extraPerMonth.length
    ? [0, 100, 250, 500].map((e) => { const y = yearsToGoal({ goal: I.goal, pv: I.pv, monthly: I.monthly + e, annual: I.annual }); return { extra: e, contribution: I.monthly + e, years: y }; })
    : S.data.settings.extraPerMonth;
  const rets = S.whatIf || !P_IS_NW || !S.data.settings.returnScenarios.length
    ? [0.05, 0.07, 0.1, 0.12].map((r) => ({ rate: r, years: yearsToGoal({ goal: I.goal, pv: I.pv, monthly: I.monthly, annual: r }) }))
    : S.data.settings.returnScenarios;
  const srcNote = S.whatIf ? 'What-if numbers, not saved' : 'From your Excel';
  return `
    <section class="panel summary stack">
      <span class="label">${next ? 'Next milestone' : 'Every milestone reached'}</span>
      ${next ? `<div class="hero">${esc(fmtEur(next.goal))}</div>
      <p>${next.when ? `~${esc(labelKey(next.when, 'long'))}${next.age != null ? `, at age ~${next.age}` : ''}` : 'Not reached with these numbers'} <span class="muted">(${esc(fmtYears(next.years))})</span></p>` : ''}
      <p class="tiny">Net worth today ${esc(fmtEur(I.pv))}. Adding ${esc(fmtEur(I.monthly))} a month at ${esc(fmtPct(I.annual, 1))} a year. ${esc(srcNote)}.</p>
    </section>
    ${leagues.map((lg, li) => `<section class="panel league">
      <h3>League ${li + 1}: ${esc(fmtEurCompact(lg[0].goal))} to ${esc(fmtEurCompact(lg.at(-1).goal))}</h3>
      <div class="quest-path" style="height:${lg.length * nodeH}px">
        <svg class="trail" width="${w}" height="${lg.length * nodeH}" aria-hidden="true">${lg.slice(0, -1).map((n, j) => {
          const x1 = j % 2 === 0 ? 28 : w - 28, x2 = j % 2 === 0 ? w - 28 : 28, y1 = nodeH * j + nodeH / 2, y2 = y1 + nodeH;
          return `<path class="${lg[j + 1].reached ? 'done' : ''}" d="M${x1},${y1} C${x1},${y1 + nodeH * 0.6} ${x2},${y2 - nodeH * 0.6} ${x2},${y2}"/>`;
        }).join('')}</svg>
        ${lg.map((n, j) => {
          const state = n.reached ? 'done' : n.i === cur ? 'current' : 'future';
          return `<div class="node ${state}${j % 2 ? ' right' : ''}" style="height:${nodeH}px">
            <div class="node-dot${state === 'current' ? ' shine' : ''}">${icon(state === 'done' ? 'check' : 'flag', 24)}</div>
            <div class="node-body"><div class="node-goal">${esc(fmtEur(n.goal))}</div>
            <div class="node-when">${state === 'done' ? (n.start ? 'Starting line' : 'Reached') : n.when ? `~${esc(labelKey(n.when))}${n.age != null ? `, age ~${n.age}` : ''}` : 'Not reached with these numbers'}</div>
            ${state === 'current' ? `<div class="tiny">${esc(fmtPct(stepProgress(nodes, n.i, I.pv), 0))} of the way from ${esc(fmtEurCompact(nodes[n.i - 1]?.goal ?? 0))}</div>` : ''}</div>
          </div>`;
        }).join('')}
      </div>
    </section>`).join('')}
    <section class="panel stack" style="gap:var(--sp-4)">
      <div class="panel-head" style="margin:0"><h2>Try other numbers</h2>${S.whatIf ? status('info', 'What-if') : ''}</div>
      ${field('monthly', 'Monthly contribution', I.monthly, 0, 3000, 10, fmtEur)}
      ${field('annual', 'Yearly return', I.annual, 0, 0.15, 0.005, (v) => fmtPct(v, 1))}
      <p class="tiny">Typed values accept 9,5 or 9.5 or 9,5%. These numbers only move the map; your Excel stays the source.</p>
      ${S.whatIf ? `<button class="btn block" data-act="whatif-reset">Back to your Excel values (${esc(fmtEur(P.monthly))}, ${esc(fmtPct(P.annualReturn, 1))})</button>` : ''}
    </section>
    <section class="panel">
      <h2>Cost of waiting</h2>
      <p class="small muted" style="margin-bottom:var(--sp-2)">What starting later costs by the end of ${esc(fmtNumber(I.horizon, 0))} years, with the same monthly amount.</p>
      <div class="list">${cow.map((r) => `<div class="li"><span class="grow">Start ${r.delay} year${r.delay > 1 ? 's' : ''} later</span><span class="val"><span class="num">~${esc(fmtEurCompact(r.cost))}</span><br><span class="tiny">less</span></span></div>`).join('')}</div>
    </section>
    <div class="panel" style="padding-top:0;padding-bottom:0">
      ${accordion('quest-extra', `Adding more each month (goal ${fmtEurCompact(I.goal)})`, `<div class="list">${extra.map((r) => `<div class="li"><span class="grow">${r.extra ? `+${esc(fmtEur(r.extra))} a month` : 'As now'}<br><span class="tiny">${esc(fmtEur(r.contribution))} in total</span></span><span class="val num">${esc(fmtYears(r.years))}</span></div>`).join('')}</div>`)}
      ${accordion('quest-returns', `Other yearly returns (goal ${fmtEurCompact(I.goal)})`, `<div class="list">${rets.map((r) => `<div class="li"><span class="grow">${esc(fmtPct(r.rate, 0))} a year</span><span class="val num">${esc(fmtYears(r.years))}</span></div>`).join('')}</div>`)}
    </div>`;
}
function field(id, label, value, min, max, step, fmt) {
  const shown = id === 'annual' ? fmtNumber(value * 100, 1) + '%' : fmtNumber(value, 0);
  return `<div class="field">
    <div class="field-top"><label for="in-${id}">${esc(label)}</label><input type="text" inputmode="decimal" id="in-${id}" data-input="${id}" value="${esc(shown)}" aria-label="${esc(label)}"></div>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-range="${id}" aria-label="${esc(label)} slider" aria-valuetext="${esc(fmt(value))}">
  </div>`;
}

function rewards() {
  const G = S.game, lv = G.level;
  const ch = S.saved.challenges;
  const hist = ch.history.slice(0, 6);
  const unlocked = G.badges.filter((b) => b.unlocked).length;
  const stIcon = { completed: ['checkCircle', 'good', 'Done'], failed: ['xCircle', 'attention', 'Missed'], 'no-data': ['minusCircle', 'info', 'No data for that month'], active: ['dotCircle', 'info', 'In progress'] };
  const chItem = (it) => { const [ic, k, word] = stIcon[it.status]; return `<div class="ch-item"><span class="status ${k}">${icon(ic, 22)}</span><div class="grow"><div>${esc(it.title)}</div><div class="tiny">${esc(word)}${it.status === 'completed' ? `, +${XP.challenge} XP` : ''}. ${esc(it.detail || '')}</div></div></div>`; };
  return `
    <section class="panel summary">
      <div class="level-hero">${levelBadge(lv)}
        <div class="grow stack" style="gap:4px"><span class="label">Level ${lv.level}</span><h2 style="margin:0">${esc(lv.title)}</h2>
        <span class="num">${esc(fmtXP(lv.xp))}</span>${meter(lv.progress, { reward: true, label: `${fmtXP(lv.xp - lv.floor)} of ${fmtXP(lv.next - lv.floor)}` })}<span class="tiny">${esc(fmtXP(lv.next - lv.xp))} to level ${lv.level + 1}</span></div>
      </div>
      <p class="tiny" style="margin-top:var(--sp-3)">${esc(fmtXP(G.xp.monthXP))} from ${S.data.months.length} months in your file, ${esc(fmtXP(G.xp.challengeXP))} from challenges.</p>
      <button class="btn small block" style="margin-top:var(--sp-3)" data-act="layer" data-kind="points">How points work</button>
    </section>
    <section class="panel">
      <h2>Streaks</h2>
      <div class="list">${G.streaks.map((s) => `<div class="li streak"><div><div>${esc(s.title)}</div><div class="tiny">${esc(s.rule)}</div></div><div><div class="num">${s.current}</div><div class="tiny">now</div></div><div><div class="num" style="color:var(--ink-2)">${s.best}</div><div class="tiny">best</div></div></div>`).join('')}</div>
    </section>
    <section class="panel">
      <h2>Challenges</h2>
      ${ch.active ? `<p class="small muted">For ${esc(labelKey(ch.active.forMonth, 'long'))}. Checked when you load a file that includes that month. ${XP.challenge} XP each.</p>${ch.active.items.map(chItem).join('')}` : '<p class="small muted">New challenges appear after your next upload.</p>'}
      ${hist.length ? accordion('ch-history', `Earlier challenges (last ${hist.length})`, hist.map((h) => `<div><h3 style="margin-top:var(--sp-2)">${esc(labelKey(h.forMonth, 'long'))}</h3>${h.items.map(chItem).join('')}</div>`).join('')) : ''}
    </section>
    <section class="stack" style="gap:var(--sp-3)">
      <div class="panel-head" style="margin:0"><h2>Badges</h2><span class="tiny">${unlocked} of ${G.badges.length} unlocked</span></div>
      <div class="badges">${G.badges.map((b) => badgeCard(b)).join('')}</div>
    </section>`;
}
function badgeCard(b, pop = false) {
  return `<button class="tap badge ${b.unlocked ? 'unlocked' : 'locked'}${pop ? ' pop' : ''}" data-act="layer" data-kind="badge" data-arg="${esc(b.id)}" aria-label="${esc(b.title)}, ${b.unlocked ? 'unlocked' : 'locked'}">
    <div class="badge-ico">${icon(b.icon, 26)}</div>
    <div class="badge-title">${esc(b.title)}</div>
    <div class="badge-cond">${esc(b.condition)}</div>
    ${b.unlocked ? `<span class="badge-state status good">${icon('checkCircle', 14)}<span>${esc(b.unlockedKey ? labelKey(b.unlockedKey) : fmtDateTime(b.unlockedDate))}</span></span>` : `${meter(b.progress, { reward: true, label: b.progressText })}<span class="tiny">${esc(b.progressText)}</span>`}
  </button>`;
}

// ---------------- Layers (pages that grow out of the tapped element) ----------------
function layerContent(kind, arg) {
  const T = S.game?.T;
  switch (kind) {
    case 'more': {
      const ms = S.data?.months;
      return { title: 'More', body: `
        <section class="panel stack">
          <h2>Your data</h2>
          ${ms ? `<p class="small muted">${ms.length} months, ${esc(labelKey(ms[0].key))} to ${esc(labelKey(ms.at(-1).key))}. Loaded ${esc(fmtDateTime(S.saved.meta.lastUploadAt))}, ${S.saved.meta.uploads} upload${S.saved.meta.uploads === 1 ? '' : 's'} so far.</p>` : '<p class="small muted">No file loaded yet.</p>'}
          ${S.data?.warnings?.length ? `<div class="stack">${S.data.warnings.map((w) => status('attention', w)).join('')}</div>` : ''}
          <button class="btn primary block" data-act="upload">${icon('upload', 20)}${ms ? 'Update from Excel' : 'Choose Excel file'}</button>
        </section>
        <section class="panel list" style="padding-top:0;padding-bottom:0">
          ${[['points', 'How points work', 'star'], ['glossary', 'Words used in the app', 'book'], ['privacy', 'Privacy', 'privacy']].map(([k, l, ic]) => `<button class="tap li" data-act="layer" data-kind="${k}"><span style="color:var(--accent)">${icon(ic, 22)}</span><span class="grow">${l}</span>${icon('chevronR', 18).replace('class="ico"', 'class="ico chev"')}</button>`).join('')}
        </section>
        <section class="panel stack">
          <h2>Settings</h2>
          <button class="btn block" data-act="export">${icon('download', 20)}Export my progress</button>
          <p class="tiny">Saves a JSON file with your level, badges and challenges. It does not include your balances.</p>
          <button class="btn danger block" data-act="reset">${icon('trash', 20)}${S.resetArmed ? 'Tap again to erase everything' : 'Reset all data'}</button>
          ${S.resetArmed ? `<p class="confirm-note">${icon('alert', 18)}This removes the loaded file, progress, badges and challenges from this phone.</p>` : ''}
        </section>
        <p class="tiny" style="text-align:center">Money Quest, offline app. Version ${APP_VERSION}.</p>` };
    }
    case 'points': {
      const th = T || { savingsTarget: 0.2, emergencyMonths: 6 };
      const levels = [1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<div class="li"><span class="grow">Level ${n}, ${LEVEL_TITLES.slice().reverse().find((t) => n >= t.from).title}</span><span class="val num">${esc(fmtXP(xpForLevel(n)))}</span></div>`).join('');
      return { title: 'How points work', body: `
        <section class="panel stack">
          <h2>Experience points (XP)</h2>
          <p class="small">Every month in your file earns XP. Loading the same file twice never adds more.</p>
          <div class="list">
            <div class="li"><span class="grow">Each score point (0 to 6)</span><span class="val num">${XP.perScorePoint} XP</span></div>
            <div class="li"><span class="grow">Your investment return beats the S&P 500</span><span class="val num">+${XP.beatMarket} XP</span></div>
            <div class="li"><span class="grow">Savings rate at ${esc(fmtPct(th.savingsTarget, 0))} or more</span><span class="val num">+${XP.savingsTarget} XP</span></div>
            <div class="li"><span class="grow">Emergency fund at ${esc(fmtNumber(th.emergencyMonths, 0))} months or more</span><span class="val num">+${XP.emergencyReady} XP</span></div>
            <div class="li"><span class="grow">Each completed challenge</span><span class="val num">+${XP.challenge} XP</span></div>
          </div>
        </section>
        <section class="panel stack">
          <h2>Levels</h2>
          <p class="small">Level n needs 300 × n<sup>1,5</sup> XP in total, rounded. Each level is a little further away than the last.</p>
          <div class="list">${levels}</div>
        </section>
        <section class="panel stack">
          <h2>Streaks</h2>
          <p class="small">A streak counts the most recent months in a row that meet a rule. A missing month ends it. The four rules are listed under Quest, Rewards.</p>
        </section>
        <section class="panel stack">
          <h2>Challenges</h2>
          <p class="small">After each upload, three challenges are set for the month after your latest one, based on your own numbers. When a later upload contains that month, they are checked: done, missed, or no data.</p>
        </section>
        <section class="panel stack">
          <h2>Badges</h2>
          <p class="small">Each badge shows its condition. Unlock dates are worked out from your history, so older months count too.</p>
        </section>` };
    }
    case 'glossary':
      return { title: 'Words used in the app', body: `<section class="panel"><div class="list">${[
        ['Net worth', 'Everything in your accounts added up. In the Excel it is the NW column. The quest map tracks this.'],
        ['Invested assets', 'Trading212, Stake and Robinhood together.'],
        ['Investment return', 'How much your investments grew in a month without the money you added (the "→ Invest" value). This is what is compared with the S&P 500.'],
        ['Emergency fund', 'The NI T212 account, measured in months of average spending.'],
        ['Savings rate', 'The share of income you did not spend, from the Savings rate column.'],
        ['S&P 500', 'An index of 500 large US companies, used as the market to beat.'],
        ['Monthly change (Me %)', 'How much your net worth moved in a month. It includes money you added.'],
        ['Cash flow (CF)', 'Change in cash accounts from one month to the next.'],
        ['Allocation', 'How your net worth splits between investments, emergency fund, lifestyle and fun money.'],
        ['Deviation (Desvio)', 'How far investments and emergency fund sit from their targets. Lower is better.'],
        ['Liquidity ratio', 'The share of net worth you can spend quickly.'],
        ['Score and rating', 'Your workbook’s 0 to 6 monthly score, and its name: Reset Your Plan, Needs Attention, Building, Strong.'],
        ['XP, level, streak', 'The game layer. See How points work.'],
      ].map(([t, d]) => `<div class="li" style="align-items:flex-start;flex-direction:column;gap:2px"><b>${t}</b><span class="small muted">${d}</span></div>`).join('')}</div></section>` };
    case 'privacy':
      return { title: 'Privacy', body: `<section class="panel stack">
        <p>Your Excel file is read inside this browser on this phone. It is never uploaded.</p>
        <p class="small muted">The parsed numbers, your progress and challenges are stored in this browser’s local storage only. The app has no accounts, no analytics and no server. Its code is public; your data is not part of it.</p>
        <p class="small muted">Reset all data (in More) erases everything from this phone. Deleting the app from the home screen does the same on most phones.</p></section>` };
    case 'badge': {
      const b = S.game.badges.find((x) => x.id === arg);
      if (!b) return { title: 'Badge', body: '' };
      return { title: b.title, body: `<section class="panel summary stack" style="align-items:flex-start">
          <div class="badge ${b.unlocked ? 'unlocked' : 'locked'}" style="border:0;padding:0;min-height:0;background:transparent"><div class="badge-ico pop" style="width:88px;height:88px;border-radius:24px">${icon(b.icon, 44)}</div></div>
          ${b.unlocked ? status('good', `Unlocked ${b.unlockedKey ? `in ${labelKey(b.unlockedKey, 'long')}` : fmtDateTime(b.unlockedDate)}`) : status('info', 'Not unlocked yet', 'dotCircle')}
          <p>${esc(b.condition)}.</p>
          ${b.unlocked ? '' : `${meter(b.progress, { reward: true, label: b.progressText })}<span class="tiny">${esc(b.progressText)}</span>`}
        </section>` };
    }
    case 'account': {
      const ms = S.data.months, ks = keys();
      const series = [{ name: arg, values: ms.map((m) => m.accounts[arg] ?? null), color: 'var(--s1)' }];
      const L = latest(), prev = ms.at(-2);
      return { title: arg, body: `<section class="panel summary"><span class="label">${esc(labelKey(L.key, 'long'))}</span><div class="hero">${esc(fmtEur(L.accounts[arg] ?? 0))}</div>${prev ? delta((L.accounts[arg] ?? 0) - (prev.accounts[arg] ?? 0), { rest: `on ${labelKey(prev.key, 'long')}` }) : ''}</section>
        <section class="panel"><h2>Balance by month</h2>${lineChart({ id: 'acct', keys: ks, series, w: chartWidth(), fmt: (v) => fmtEur(v), axisFmt: fmtEurCompact, area: true, zero: true, title: `${arg} balance by month` })}
        ${accordion('acct-table', 'Show as table', dataTable({ keys: ks, series, fmt: (v) => fmtEur(v) }))}</section>` };
    }
    case 'category': {
      const sm = S.data.spend.months, ks = sm.map((m) => m.key);
      const vals = sm.map((m) => m.byCat[arg] ?? 0);
      const last = sm.at(-1);
      const prior = sm.filter((m) => monthDiff(m.key, last.key) > 0 && monthDiff(m.key, last.key) <= (S.data.settings.lookback || 12));
      const avg = avgOf(prior.map((m) => m.byCat[arg] ?? 0));
      const series = [{ name: arg, values: vals, color: SERIES[Math.max(0, S.data.spend.categories.indexOf(arg)) % 8] }];
      return { title: arg, body: `<section class="panel summary"><span class="label">${esc(labelKey(last.key, 'long'))}</span><div class="hero">${esc(fmtEur(last.byCat[arg] ?? 0))}</div>
          ${avg != null ? delta((last.byCat[arg] ?? 0) - avg, { goodWhenUp: false, rest: `on your average of the previous ${prior.length} months (~${fmtEur(avg)})` }) : ''}</section>
        <section class="panel"><h2>${esc(arg)} by month</h2>${lineChart({ id: 'cat', keys: ks, series, w: chartWidth(), fmt: (v) => fmtEur(v), axisFmt: fmtEurCompact, area: true, zero: true, title: `${arg} spending by month` })}
        ${accordion('cat-table', 'Show as table', dataTable({ keys: ks, series, fmt: (v) => fmtEur(v) }))}</section>` };
    }
    case 'result': {
      const r = S.saved.lastResult;
      if (!r) return { title: 'Updated', body: '' };
      const nb = r.newBadges.map((id) => S.game.badges.find((b) => b.id === id)).filter(Boolean);
      const chEv = r.challengeEvents.filter((e) => e.type === 'challenge');
      return { title: 'File loaded', body: `
        <section class="panel summary stack">
          ${status('good', `Read ${S.data.months.length} months, up to ${labelKey(r.latestKey, 'long')}`)}
          <div class="hero">${r.xpGained > 0 ? `+${esc(fmtXP(r.xpGained))}` : esc(fmtXP(S.game.level.xp))}</div>
          <p class="muted small">${r.xpGained > 0 ? 'Gained with this upload.' : 'No new XP: no new months or challenges in this file.'} ${r.levelAfter > r.levelBefore ? `You reached level ${r.levelAfter}.` : `Level ${r.levelAfter}.`}</p>
        </section>
        ${nb.length ? `<section class="stack" style="gap:var(--sp-3)"><h2>New badge${nb.length > 1 ? 's' : ''}</h2><div class="badges">${nb.map((b) => badgeCard(b, true)).join('')}</div></section>` : ''}
        ${chEv.length ? `<section class="panel"><h2>Challenges checked</h2>${chEv.map((e) => `<div class="ch-item">${status(e.status === 'completed' ? 'good' : e.status === 'failed' ? 'attention' : 'info', e.status === 'completed' ? 'Done' : e.status === 'failed' ? 'Missed' : 'No data', e.status === 'completed' ? 'checkCircle' : e.status === 'failed' ? 'xCircle' : 'minusCircle')}<span class="grow">${esc(e.title)}</span></div>`).join('')}</section>` : ''}
        ${S.data.warnings.length ? `<section class="panel stack"><h2>Things to check in the file</h2>${S.data.warnings.map((w) => status('attention', w)).join('')}</section>` : ''}
        <button class="btn primary block" data-act="close-goto" data-tab="home">See home</button>` };
    }
    case 'error':
      return { title: 'Could not read the file', body: `<section class="panel summary stack">${status('critical', arg || 'This file could not be read.')}
        <p class="small muted">Choose the .xlsx file of your finance workbook (with the NW CF sheet). Files from Numbers or Google Sheets work if exported as Excel.</p>
        <button class="btn primary block" data-act="upload">${icon('upload', 20)}Choose another file</button></section>` };
  }
  return { title: '', body: '' };
}

function openLayer(kind, arg, fromEl, { push = true } = {}) {
  const { title, body } = layerContent(kind, arg);
  const el = document.createElement('div');
  el.className = 'layer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="layer-head"><button class="icon-btn" data-act="back" aria-label="Close">${icon(S.layers.length ? 'back' : 'close', 22)}</button><h1>${esc(title)}</h1></div><div class="view-inner">${body}</div>`;
  document.body.appendChild(el);
  const rect = fromEl?.getBoundingClientRect?.();
  const entry = { kind, arg, el, rect, focusBack: fromEl };
  S.layers.push(entry);
  if (push) history.pushState({ layer: S.layers.length }, '');
  bindCharts(el);
  growIn(el, rect);
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
  document.querySelectorAll('.view, .tabbar').forEach((v) => v.setAttribute('aria-hidden', 'true'));
}
function clipFrom(rect) {
  const W = window.innerWidth, H = window.innerHeight;
  return `inset(${rect.top.toFixed(0)}px ${(W - rect.right).toFixed(0)}px ${(H - rect.bottom).toFixed(0)}px ${rect.left.toFixed(0)}px round 20px)`;
}
function growIn(el, rect) {
  if (reduceMotion() || !el.animate) return;
  if (rect && rect.width) {
    el.animate([{ clipPath: clipFrom(rect), opacity: 0.6 }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  } else {
    el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }
}
function closeTopLayer() {
  const entry = S.layers.pop();
  if (!entry) return;
  const { el, rect, focusBack } = entry;
  const done = () => { el.remove(); if (!S.layers.length) document.querySelectorAll('.view, .tabbar').forEach((v) => v.removeAttribute('aria-hidden')); if (focusBack && document.contains(focusBack)) focusBack.focus({ preventScroll: true }); };
  if (reduceMotion() || !el.animate) { done(); return; }
  const r = rect && document.contains(entry.focusBack) ? entry.focusBack.getBoundingClientRect() : rect;
  const a = r && r.width
    ? el.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 }, { clipPath: clipFrom(r), opacity: 0.4 }], { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' })
    : el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(16px)' }], { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
  a.onfinish = done;
}
function refreshLayers() {
  for (const L of S.layers) {
    const { title, body } = layerContent(L.kind, L.arg);
    L.el.querySelector('.layer-head h1').textContent = title;
    L.el.querySelector('.view-inner').innerHTML = body;
    bindCharts(L.el);
  }
}
window.addEventListener('popstate', () => {
  if (S.layers.length) { closeTopLayer(); if (S.resetArmed) { S.resetArmed = false; } }
});

// ---------------- Rendering & tabs ----------------
const VIEWS = { home: viewHome, wealth: viewWealth, allocation: viewAllocation, spend: viewSpend, quest: viewQuest };
function renderTab(id) {
  const el = document.getElementById(`view-${id}`);
  el.innerHTML = VIEWS[id]();
  bindCharts(el);
}
function renderAll() {
  S.animate = true;
  TABS.forEach((t) => renderTab(t.id));
  S.animate = false;
  renderTabbar();
}
function renderTabbar() {
  document.getElementById('tabbar').innerHTML = TABS.map((t) => `<button class="tab" role="tab" data-act="tab" data-tab="${t.id}" aria-selected="${S.tab === t.id}" aria-label="${t.label}">${icon(t.icon, 26)}<span>${t.label}</span></button>`).join('');
}
function switchTab(id, sub) {
  const oldIdx = TABS.findIndex((t) => t.id === S.tab), newIdx = TABS.findIndex((t) => t.id === id);
  const view = document.getElementById(`view-${id}`);
  if (id === S.tab && !sub) { view.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; }
  if (sub && S.sub[id] !== sub) { setSub(id, sub, false); }
  document.getElementById(`view-${S.tab}`).hidden = true;
  S.tab = id;
  view.hidden = false;
  view.classList.remove('enter-right', 'enter-left');
  if (!reduceMotion() && oldIdx !== newIdx) { void view.offsetWidth; view.classList.add(newIdx > oldIdx ? 'enter-right' : 'enter-left'); }
  S.animate = true; renderTab(id); S.animate = false;
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
}
function setSub(page, v, rerender = true) {
  const view = document.getElementById(`view-${page}`);
  S.subScroll[`${page}:${S.sub[page]}`] = view.scrollTop;
  S.sub[page] = v;
  if (!rerender) return;
  S.animate = true; renderTab(page); S.animate = false;
  const body = view.querySelector('.sub-body');
  if (body && !reduceMotion()) body.classList.add('sub-enter');
  view.scrollTop = S.subScroll[`${page}:${v}`] ?? 0;
}

// ---------------- File loading ----------------
const fileInput = document.getElementById('file');
function showBusy(text) {
  let b = document.querySelector('.busy');
  if (!b) { b = document.createElement('div'); b.className = 'busy'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'assertive'); document.body.appendChild(b); }
  b.innerHTML = `<div class="busy-box"><span class="spinner" aria-hidden="true"></span><span>${esc(text)}</span></div>`;
}
const hideBusy = () => document.querySelector('.busy')?.remove();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function handleFile(file) {
  if (!file) return;
  showBusy('Reading file…');
  await nextFrame();
  let data;
  try {
    if (!XLSX) throw new Error('The Excel reader did not load. Reload the app and try again.');
    const buf = await file.arrayBuffer();
    data = parseWorkbook(XLSX, buf);
    if (!data.months.length) throw new Error('No monthly rows were found in the NW CF sheet.');
  } catch (err) {
    hideBusy();
    while (S.layers.length) { S.layers.pop().el.remove(); }
    openLayer('error', err && err.message ? err.message : 'This file could not be read.', null);
    return;
  }
  showBusy('Saving…');
  await nextFrame();
  const now = new Date().toISOString();
  const before = S.game;
  const saved = JSON.parse(JSON.stringify(S.saved));
  saved.meta.firstUploadAt = saved.meta.firstUploadAt || now;
  saved.meta.lastUploadAt = now;
  saved.meta.uploads = (saved.meta.uploads || 0) + 1;
  const ch = applyUploadToChallenges(saved.challenges, data, now);
  saved.challenges = ch.state;
  const game = computeGame(data, saved);
  const newBadges = game.badges.filter((b) => b.unlocked && !saved.badgeLog[b.id]).map((b) => b.id);
  for (const id of newBadges) saved.badgeLog[id] = { at: now };
  saved.prev = before ? { latestKey: S.data.months.at(-1).key, xp: before.xp.total, level: before.level.level } : null;
  saved.lastResult = {
    at: now, latestKey: data.months.at(-1).key,
    xpGained: game.xp.total - (before?.xp.total ?? 0),
    levelBefore: before?.level.level ?? 0, levelAfter: game.level.level,
    newBadges, challengeEvents: ch.events,
  };
  S.data = data; S.saved = saved; S.game = game;
  if (!saveAll(data, saved)) {
    hideBusy();
    openLayer('error', 'This phone did not allow saving (storage full or private browsing). Your data was read but will not be kept.', null);
  }
  S.month = { wealth: null, allocation: null };
  S.whatIf = null;
  renderAll();
  hideBusy();
  while (S.layers.length) { S.layers.pop().el.remove(); }
  document.querySelectorAll('.view, .tabbar').forEach((v) => v.removeAttribute('aria-hidden'));
  history.replaceState({ base: true }, '');
  openLayer('result', null, null);
}
fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; handleFile(f); });

// ---------------- Actions ----------------
const APP_VERSION = '1.0.0';
function exportProgress() {
  const g = S.game;
  const out = {
    app: 'Money Quest', exportedAt: new Date().toISOString(), version: APP_VERSION,
    note: 'Progress only. Balances and other workbook values are not included.',
    level: g ? { level: g.level.level, title: g.level.title, xp: g.xp } : null,
    streaks: g ? g.streaks.map((s) => ({ id: s.id, current: s.current, best: s.best })) : [],
    badges: g ? g.badges.map((b) => ({ id: b.id, unlocked: b.unlocked, month: b.unlockedKey ?? null, firstSeen: S.saved.badgeLog[b.id]?.at ?? null })) : [],
    challenges: S.saved.challenges, meta: S.saved.meta,
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `money-quest-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function doReset() {
  resetAll();
  S.data = null; S.saved = emptySaved(); S.game = null; S.resetArmed = false; S.whatIf = null;
  while (S.layers.length) S.layers.pop().el.remove();
  document.querySelectorAll('.view, .tabbar').forEach((v) => v.removeAttribute('aria-hidden'));
  history.replaceState({ base: true }, '');
  TABS.forEach((t) => { document.getElementById(`view-${t.id}`).hidden = t.id !== 'home'; });
  S.tab = 'home';
  renderAll();
}

const ACTIONS = {
  tab: (el) => { el.classList.remove('squash'); void el.offsetWidth; el.classList.add('squash'); switchTab(el.dataset.tab); },
  goto: (el) => switchTab(el.dataset.tab, el.dataset.sub),
  'close-goto': (el) => { history.back(); switchTab(el.dataset.tab); },
  sub: (el) => { if (S.sub[el.dataset.page] !== el.dataset.v) setSub(el.dataset.page, el.dataset.v); },
  month: (el) => {
    const ks = keys(), page = el.dataset.page;
    const i = ks.indexOf(pageMonth(page)) + Number(el.dataset.d);
    if (i < 0 || i >= ks.length) return;
    S.month[page] = ks[i];
    renderTab(page);
  },
  acc: (el) => {
    const id = el.dataset.id, body = document.getElementById(`acc-${id}`);
    const open = !S.open.has(id);
    open ? S.open.add(id) : S.open.delete(id);
    el.setAttribute('aria-expanded', String(open));
    body.classList.toggle('open', open);
    if (open) bindCharts(body);
  },
  upload: () => fileInput.click(),
  layer: (el) => openLayer(el.dataset.kind, el.dataset.arg, el),
  back: () => history.back(),
  export: exportProgress,
  reset: () => { if (S.resetArmed) doReset(); else { S.resetArmed = true; refreshLayers(); } },
  'whatif-reset': () => { S.whatIf = null; renderTab('quest'); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el, e);
});

// What-if inputs: slider and forgiving text field stay in sync.
function setWhatIf(id, value) {
  const P = S.data.settings.projection;
  const cur = { monthly: S.whatIf?.monthly ?? P.monthly ?? 0, annual: S.whatIf?.annual ?? P.annualReturn ?? 0.07 };
  cur[id] = value;
  S.whatIf = (cur.monthly === P.monthly && cur.annual === P.annualReturn) ? null : cur;
}
document.addEventListener('input', (e) => {
  const r = e.target.closest('[data-range]');
  if (!r) return;
  setWhatIf(r.dataset.range, Number(r.value));
  const view = document.getElementById('view-quest');
  const st = view.scrollTop;
  renderTab('quest');
  view.scrollTop = st;
  document.querySelector(`[data-range="${r.dataset.range}"]`)?.focus({ preventScroll: true });
});
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-input]');
  if (!t) return;
  const id = t.dataset.input;
  let v = parseLooseNumber(t.value, { percentAsFraction: false });
  if (v == null) { renderTab('quest'); return; }
  if (id === 'annual') v = v / 100; // typed as a percent: 9,5 -> 9,5 %
  v = id === 'annual' ? Math.max(0, Math.min(0.5, v)) : Math.max(0, Math.min(100000, v));
  setWhatIf(id, v);
  const view = document.getElementById('view-quest');
  const st = view.scrollTop;
  renderTab('quest');
  view.scrollTop = st;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('[data-input]')) e.target.blur();
  if (e.key === 'Escape' && S.layers.length) history.back();
});

let resizeQueued = false;
window.addEventListener('resize', () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; TABS.forEach((t) => renderTab(t.id)); refreshLayers(); });
});

// ---------------- Boot ----------------
history.replaceState({ base: true }, '');
renderAll();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
