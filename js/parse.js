// Workbook parser. Pure: takes the SheetJS library and the file bytes, returns a plain data model.
// Rules: find everything by header/label NAME (never by fixed position), read Excel's cached
// values (cell.v), tolerate missing sheets, columns and blank cells.
import { toYMD, monthKey } from './dates.js';

export const PARSER_VERSION = 1;

/** Normalise a label: strip accents, lowercase, collapse whitespace. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Accept numbers or numeric-looking strings; '' / null / text -> null. */
export function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'boolean' || v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = parseLooseNumber(s);
  return n;
}

/**
 * Forgiving number reader for typed input: 9,5 / 9.5 / 9 500 / 9,5 km / 95% / 12 345 € / 5.678,9
 * Returns a number (percent strings return the fraction, e.g. '95%' -> 0.95) or null.
 */
export function parseLooseNumber(input, { percentAsFraction = true } = {}) {
  if (typeof input === 'number') return isFinite(input) ? input : null;
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  const isPct = /%\s*$/.test(s);
  s = s.replace(/[^\d,.\-+−]/g, '').replace(/−/g, '-');
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the later one is the decimal mark.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    // '1,234' with exactly 3 trailing digits and several groups -> thousands; otherwise decimal comma.
    if (parts.length > 2) s = parts.join('');
    else s = s.replace(',', '.');
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    if (parts.length > 2) s = parts.join('');
  }
  const n = Number(s);
  if (!isFinite(n)) return null;
  return isPct && percentAsFraction ? n / 100 : n;
}

/** Turn a SheetJS worksheet into a dense grid of cached values. */
export function sheetGrid(XLSX, ws) {
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      let v = cell ? cell.v : null;
      if (cell && cell.t === 'e') v = null; // #N/A, #DIV/0! ...
      if (typeof v === 'string') v = v.trim() === '' ? null : v.trim();
      row.push(v ?? null);
    }
    rows.push(row);
  }
  return rows;
}

function findSheet(wb, wanted) {
  const w = norm(wanted);
  const name = wb.SheetNames.find((n) => norm(n) === w) || wb.SheetNames.find((n) => norm(n).replace(/\s/g, '') === w.replace(/\s/g, ''));
  return name ? wb.Sheets[name] : null;
}

/** Find cells whose normalised text satisfies `test`. */
function findCells(grid, test) {
  const out = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const v = grid[r][c];
      if (typeof v === 'string' && test(norm(v))) out.push({ r, c });
    }
  }
  return out;
}
const eq = (label) => (s) => s === norm(label);
const starts = (label) => (s) => s.startsWith(norm(label));

/** First numeric cell to the right of a label (within `span` columns). */
function valueRight(grid, test, span = 3, nth = 0) {
  const hits = findCells(grid, test);
  const hit = hits[nth];
  if (!hit) return null;
  for (let c = hit.c + 1; c <= hit.c + span && c < grid[hit.r].length; c++) {
    const v = grid[hit.r][c];
    if (v != null) return v;
  }
  return null;
}

/**
 * Read a month-keyed table: header row contains 'Mês' (or 'Mes'/'Month').
 * Returns { headers: [{name, c}], rows: [{key, cells: {name: value}}] }.
 */
function readMonthTable(grid) {
  const isMonthHeader = (s) => s === 'mes' || s === 'month' || s === 'mês';
  let hr = -1, mc = -1;
  for (let r = 0; r < Math.min(grid.length, 15) && hr < 0; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const v = grid[r][c];
      if (typeof v === 'string' && isMonthHeader(norm(v))) { hr = r; mc = c; break; }
    }
  }
  if (hr < 0) return null;
  const headers = [];
  for (let c = 0; c < grid[hr].length; c++) {
    const v = grid[hr][c];
    if (c !== mc && typeof v === 'string') headers.push({ name: v, n: norm(v), c });
  }
  const rows = [];
  const seen = new Set();
  for (let r = hr + 1; r < grid.length; r++) {
    const ymd = toYMD(grid[r][mc]);
    if (!ymd || ymd.y < 1990 || ymd.y > 2200) continue; // tolerate blank or note rows
    const key = monthKey(ymd);
    if (seen.has(key)) continue;
    seen.add(key);
    const cells = {};
    for (const h of headers) cells[h.n] = grid[r][h.c];
    rows.push({ key, r, cells });
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : 1));
  return { headers, rows, headerRow: hr, monthCol: mc };
}

/** Pick a header by exact name or name prefix (e.g. 'Investments (80%)'). */
function pickHeader(table, ...names) {
  if (!table) return null;
  for (const name of names) {
    const n = norm(name);
    const h = table.headers.find((x) => x.n === n) || table.headers.find((x) => x.n.startsWith(n));
    if (h) return h.n;
  }
  return null;
}

// ---------- sheet readers ----------

const KNOWN_ACCOUNTS = ['Santander', 'Activo', 'NI T212', 'PayPal', 'Vinted', 'Stake', 'Trading212', 'Robinhood', 'Vivo'];
const NWCF_METRICS = ['nw', 'me %', 's&p %', 'δ%', 'Δ%', 'cf', 'income', 'saved', 'spending', 'savings rate', 'sav pts',
  'emergency months', 'emerg pts', 'alloc pts', 'score', 'rating'].map(norm);

export const ACCOUNT_GROUPS = {
  Investments: ['Trading212', 'Stake', 'Robinhood'],
  Emergency: ['NI T212'],
  Lifestyle: ['Santander'],
  'Fun Money': ['Activo'],
};

function parseNWCF(grid, warnings) {
  const t = readMonthTable(grid);
  if (!t) { warnings.push('Sheet "NW CF" has no "Mês" header; net worth history is empty.'); return { months: [], accounts: [] }; }
  const knownNorm = KNOWN_ACCOUNTS.map(norm);
  // Accounts: the known names that exist, plus any other text header that is not a metric
  // and appears left of the NW column (new accounts added by the user).
  const nwCol = t.headers.find((h) => h.n === 'nw');
  const accounts = t.headers.filter((h) => {
    if (knownNorm.includes(h.n)) return true;
    if (NWCF_METRICS.includes(h.n)) return false;
    return nwCol ? h.c < nwCol.c : false;
  });
  const H = (...n) => pickHeader(t, ...n);
  const cols = {
    nw: H('NW'), me: H('Me %'), sp: H('S&P %'), delta: H('Δ%', 'Δ %', 'Delta %'), cf: H('CF'), income: H('Income'),
    saved: H('Saved'), spending: H('Spending'), savingsRate: H('Savings rate'), savPts: H('Sav pts'),
    emergMonths: H('Emergency months'), emergPts: H('Emerg pts'), allocPts: H('Alloc pts'), score: H('Score'), rating: H('Rating'),
  };
  for (const [k, v] of Object.entries(cols)) if (!v && ['nw', 'score', 'rating'].includes(k)) warnings.push(`"NW CF" is missing the "${k === 'nw' ? 'NW' : k[0].toUpperCase() + k.slice(1)}" column.`);
  const months = [];
  for (const row of t.rows) {
    const acc = {};
    let any = false;
    for (const a of accounts) {
      const v = num(row.cells[a.n]);
      acc[a.name] = v ?? 0;
      if (v != null) any = true;
    }
    let nw = cols.nw ? num(row.cells[cols.nw]) : null;
    if (nw == null && any) nw = Object.values(acc).reduce((s, v) => s + v, 0);
    if (nw == null && !any) continue; // empty future row
    const get = (k) => (cols[k] ? num(row.cells[cols[k]]) : null);
    const rating = cols.rating && typeof row.cells[cols.rating] === 'string' ? row.cells[cols.rating] : null;
    months.push({
      key: row.key, accounts: acc, nw,
      me: get('me'), sp: get('sp'), delta: get('delta'), cf: get('cf'), income: get('income'), saved: get('saved'),
      spending: get('spending'), savingsRate: get('savingsRate'), savPts: get('savPts'), emergMonths: get('emergMonths'),
      emergPts: get('emergPts'), allocPts: get('allocPts'), score: get('score'), rating,
    });
  }
  // Derived buckets (Investments = Trading212 + Stake + Robinhood, Emergency = NI T212, ...).
  for (const m of months) {
    m.groups = {};
    let grouped = 0;
    for (const [g, names] of Object.entries(ACCOUNT_GROUPS)) {
      m.groups[g] = names.reduce((s, n) => s + (m.accounts[n] ?? 0), 0);
      grouped += m.groups[g];
    }
    m.groups.Other = Object.values(m.accounts).reduce((s, v) => s + v, 0) - grouped;
    m.invested = m.groups.Investments;
    if (m.delta == null && m.me != null && m.sp != null) m.delta = m.me - m.sp;
  }
  return { months, accounts: accounts.map((a) => a.name) };
}

const INCOME_EXCLUDE = ['ventures', 'entrada', 'entrada total', 'recurrent', 'ano', 'hr', 'mtv', 'total'].map(norm);
const KNOWN_INCOME = ['Avô', 'POD', 'Vinted', 'Rugby', 'Outros', 'Dividendos', 'Prendas'];

function parseBASE(grid, warnings) {
  const t = readMonthTable(grid);
  if (!t) { warnings.push('Sheet "BASE" has no "Mês" header; income is empty.'); return { sources: [], months: [], split: {} }; }
  const totalH = t.headers.find((h) => h.n === 'entrada total') || t.headers.find((h) => h.n === 'entrada');
  const knownNorm = KNOWN_INCOME.map(norm);
  const sources = t.headers.filter((h) => {
    if (INCOME_EXCLUDE.includes(h.n)) return false;
    if (knownNorm.includes(h.n)) return true;
    return totalH ? h.c < totalH.c : false; // unknown new source left of the total column
  });
  const months = [];
  for (const row of t.rows) {
    const by = {};
    let any = false;
    for (const s of sources) { const v = num(row.cells[s.n]); by[s.name] = v ?? 0; if (v != null) any = true; }
    let total = totalH ? num(row.cells[totalH.n]) : null;
    if (total == null && any) total = Object.values(by).reduce((a, b) => a + b, 0);
    if (total == null) continue;
    months.push({ key: row.key, bySource: by, total });
  }
  // Helper area ("Available €", "→ Invest", ...) to the right; uses the row's own month in the Mês column.
  const split = {};
  const avail = findCells(grid, starts('available'))[0];
  if (avail) {
    const hr = avail.r;
    const col = (label) => { const c = grid[hr].findIndex((v) => typeof v === 'string' && norm(v).replace(/^→\s*/, '') === norm(label)); return c; };
    const cAvail = avail.c, cInv = col('Invest'), cEm = col('Emergency'), cLife = col('Lifestyle'), cFun = col('Fun Money');
    for (let r = hr + 1; r < grid.length; r++) {
      const ymd = toYMD(grid[r][t.monthCol]);
      if (!ymd) continue;
      const a = num(grid[r][cAvail]);
      if (a == null) continue;
      split[monthKey(ymd)] = {
        available: a, invest: cInv >= 0 ? num(grid[r][cInv]) : null, emergency: cEm >= 0 ? num(grid[r][cEm]) : null,
        lifestyle: cLife >= 0 ? num(grid[r][cLife]) : null, fun: cFun >= 0 ? num(grid[r][cFun]) : null,
      };
    }
  }
  const buffer = num(valueRight(grid, starts('buffer')));
  return { sources: sources.map((s) => s.name), months, split, buffer };
}

function parseDESPESAS(grid, warnings) {
  const t = readMonthTable(grid);
  if (!t) { warnings.push('Sheet "DESPESAS" has no "Mês" header; spending by category is empty.'); return { categories: [], months: [] }; }
  const totalH = t.headers.find((h) => h.n.startsWith('total'));
  const cats = t.headers.filter((h) => h !== totalH && (!totalH || h.c < totalH.c));
  const months = [];
  for (const row of t.rows) {
    const by = {};
    let any = false;
    for (const c of cats) { const v = num(row.cells[c.n]); by[c.name] = v ?? 0; if (v != null) any = true; }
    let total = totalH ? num(row.cells[totalH.n]) : null;
    if (total == null && any) total = Object.values(by).reduce((a, b) => a + b, 0);
    if (total == null) continue;
    months.push({ key: row.key, byCat: by, total });
  }
  return { categories: cats.map((c) => c.name), months };
}

function parseDASHBOARD(grid, warnings) {
  const out = { byMonth: {}, current: null, milestones: [], monthlySpending: null, fireNumber: null };
  const t = readMonthTable(grid);
  if (t) {
    const H = (...n) => pickHeader(t, ...n);
    const cols = { investments: H('Investments'), emergency: H('Emergency'), lifestyle: H('Lifestyle'), fun: H('Fun Money'), desvio: H('Desvio'), liquidity: H('Liquidity Ratio', 'Liquidity') };
    for (const row of t.rows) {
      const o = {};
      let any = false;
      for (const [k, h] of Object.entries(cols)) { o[k] = h ? num(row.cells[h]) : null; if (o[k] != null) any = true; }
      if (any) out.byMonth[row.key] = o;
    }
  } else warnings.push('Sheet "DASHBOARD" has no "Mês" header; allocation history is empty.');

  // "Current Allocation (...)" table with Actual / Target columns.
  const ca = findCells(grid, starts('current allocation'))[0];
  if (ca) {
    const hdr = grid[ca.r];
    const cA = hdr.findIndex((v) => typeof v === 'string' && norm(v) === 'actual');
    const cT = hdr.findIndex((v) => typeof v === 'string' && norm(v) === 'target');
    const rows = [];
    for (let r = ca.r + 1; r < grid.length; r++) {
      const label = grid[r][ca.c];
      const actual = cA >= 0 ? num(grid[r][cA]) : null;
      if (typeof label !== 'string' || actual == null) break;
      rows.push({ name: label, actual, target: cT >= 0 ? num(grid[r][cT]) : null });
    }
    out.current = rows;
  }
  // Milestones table: goal | Years | Date | Age.
  const ms = findCells(grid, eq('Milestones'))[0];
  if (ms) {
    const hdr = grid[ms.r];
    const find = (l) => hdr.findIndex((v, i) => i > ms.c && typeof v === 'string' && norm(v) === norm(l));
    const cY = find('Years'), cD = find('Date'), cAge = find('Age');
    for (let r = ms.r + 1; r < grid.length; r++) {
      const goal = num(grid[r][ms.c]);
      if (goal == null) break;
      const date = cD >= 0 ? toYMD(grid[r][cD]) : null;
      out.milestones.push({ goal, years: cY >= 0 ? num(grid[r][cY]) : null, date, age: cAge >= 0 ? num(grid[r][cAge]) : null });
    }
  }
  out.monthlySpending = num(valueRight(grid, eq('Monthly spending')));
  out.fireNumber = num(valueRight(grid, eq('FIRE number')));
  return out;
}

/** Read a small table that starts at a title cell; header names sit in the title's row. */
function readTitledTable(grid, title, headerNames) {
  const hit = findCells(grid, starts(title))[0];
  if (!hit) return [];
  const hdr = grid[hit.r];
  const cols = headerNames.map((h) => hdr.findIndex((v, i) => i > hit.c && typeof v === 'string' && norm(v) === norm(h)));
  const rows = [];
  for (let r = hit.r + 1; r < grid.length; r++) {
    const first = num(grid[r][hit.c]);
    if (first == null) break;
    rows.push([first, ...cols.map((c) => (c >= 0 ? num(grid[r][c]) : null))]);
  }
  return rows;
}

function parseSETTINGS(grid, warnings) {
  const s = {
    targets: {}, emergencyMonthsTarget: null, emergencyTargetEur: null, emergencyFundMonths: null,
    rules: {}, ratings: [], lookback: null, swr: null, projection: {}, costOfWaiting: [], extraPerMonth: [], returnScenarios: [],
  };
  if (!grid.length) { warnings.push('Sheet "SETTINGS" is missing; default targets are used.'); }
  for (const cat of ['Investments', 'Emergency', 'Lifestyle', 'Fun Money']) {
    const v = num(valueRight(grid, eq(cat), 1));
    if (v != null) s.targets[cat] = v;
  }
  s.emergencyMonthsTarget = num(valueRight(grid, starts('emergency months (target')));
  s.emergencyTargetEur = num(valueRight(grid, starts('emergency target (')));
  s.emergencyFundMonths = num(valueRight(grid, starts('emergency fund (months')));
  // Score rules: label | 2 pts if | 1 pt if
  const ruleHdr = findCells(grid, eq('Rule'))[0];
  let c2 = -1, c1 = -1;
  if (ruleHdr) {
    const hdr = grid[ruleHdr.r];
    c2 = hdr.findIndex((v) => typeof v === 'string' && /^2 ?pts?/.test(norm(v)));
    c1 = hdr.findIndex((v) => typeof v === 'string' && /^1 ?pts?/.test(norm(v)));
  }
  const rule = (label) => {
    const hit = findCells(grid, starts(label))[0];
    if (!hit) return null;
    return { two: c2 >= 0 ? num(grid[hit.r][c2]) : null, one: c1 >= 0 ? num(grid[hit.r][c1]) : null };
  };
  s.rules.savingsRate = rule('Savings rate (min');
  s.rules.emergency = rule('Emergency (min');
  s.rules.desvio = rule('Desvio (max');
  // Ratings: 'Rating' | 'Min score'
  const rh = findCells(grid, eq('Rating')).find((h) => norm(grid[h.r][h.c + 1]) === 'min score');
  if (rh) {
    for (let r = rh.r + 1; r < grid.length; r++) {
      const name = grid[r][rh.c], min = num(grid[r][rh.c + 1]);
      if (typeof name !== 'string' || min == null) break;
      s.ratings.push({ name, min });
    }
    s.ratings.sort((a, b) => a.min - b.min);
  }
  s.lookback = num(valueRight(grid, starts('lookback window')));
  s.swr = num(valueRight(grid, starts('safe withdrawal')));
  const P = s.projection;
  P.invested = num(valueRight(grid, eq('Invested today')));
  P.monthly = num(valueRight(grid, eq('Monthly contribution')));
  P.annualReturn = num(valueRight(grid, eq('Annual return')));
  P.years = num(valueRight(grid, (x) => /^years( \(|$)/.test(x)));
  P.goal = num(valueRight(grid, eq('Goal')));
  P.birth = toYMD(valueRight(grid, eq('Birth date')));
  s.costOfWaiting = readTitledTable(grid, 'Cost of waiting', ['Years invested', 'Portfolio value', 'Cost'])
    .map(([delay, years, value, cost]) => ({ delay, years, value, cost }));
  s.extraPerMonth = readTitledTable(grid, 'Extra per month', ['Contribution', 'Years to goal', 'Time saved'])
    .map(([extra, contribution, years, saved]) => ({ extra, contribution, years, saved }));
  s.returnScenarios = readTitledTable(grid, 'Return scenario', ['Years to goal'])
    .map(([rate, years]) => ({ rate, years }));
  return s;
}

/** Fill gaps with the workbook's documented defaults so the app still works with partial files. */
function withDefaults(s) {
  const d = structuredCloneSafe(s);
  d.targets = { Investments: 0.8, Emergency: null, Lifestyle: 0.05, 'Fun Money': 0.05, ...d.targets };
  d.rules.savingsRate = { two: 0.2, one: 0.1, ...(clean(d.rules.savingsRate)) };
  d.rules.emergency = { two: d.emergencyMonthsTarget ?? 6, one: (d.emergencyMonthsTarget ?? 6) / 2, ...(clean(d.rules.emergency)) };
  d.rules.desvio = { two: 0.3, one: 0.45, ...(clean(d.rules.desvio)) };
  if (!d.ratings.length) d.ratings = [{ name: 'Reset Your Plan', min: 0 }, { name: 'Needs Attention', min: 1 }, { name: 'Building', min: 3 }, { name: 'Strong', min: 5 }];
  d.emergencyMonthsTarget = d.emergencyMonthsTarget ?? d.rules.emergency.two ?? 6;
  d.lookback = d.lookback ?? 12;
  return d;
}
function clean(o) { const r = {}; if (o) for (const [k, v] of Object.entries(o)) if (v != null) r[k] = v; return r; }
function structuredCloneSafe(o) { return JSON.parse(JSON.stringify(o)); }

/** Rating name for a score using the workbook's own thresholds (one scale everywhere). */
export function ratingFor(score, ratings) {
  if (score == null) return null;
  let name = null;
  for (const r of ratings) if (score >= r.min) name = r.name;
  return name;
}

/** Main entry: bytes (ArrayBuffer/Uint8Array/Buffer) -> data model. */
export function parseWorkbook(XLSX, bytes) {
  const wb = XLSX.read(bytes, { type: bytes instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false });
  const warnings = [];
  const grid = (name) => { const ws = findSheet(wb, name); if (!ws) warnings.push(`Sheet "${name}" was not found.`); return ws ? sheetGrid(XLSX, ws) : []; };
  const nw = parseNWCF(grid('NW CF'), warnings);
  const base = parseBASE(grid('BASE'), warnings);
  const desp = parseDESPESAS(grid('DESPESAS'), warnings);
  const dash = parseDASHBOARD(grid('DASHBOARD'), warnings);
  const settings = withDefaults(parseSETTINGS(grid('SETTINGS'), warnings));
  // One rating scale: fill missing ratings from the workbook's thresholds.
  for (const m of nw.months) if (!m.rating && m.score != null) m.rating = ratingFor(m.score, settings.ratings);
  if (!nw.months.length) warnings.push('No monthly rows with values were found in "NW CF".');
  return {
    parserVersion: PARSER_VERSION,
    months: nw.months, accountNames: nw.accounts,
    income: base, spend: desp, dashboard: dash, settings, warnings,
  };
}
