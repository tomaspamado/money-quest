// Self-contained tests (synthetic data only). Run:
//   node tests/run.mjs
//   TZ=Pacific/Honolulu node tests/run.mjs && TZ=Pacific/Auckland node tests/run.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { serialToYMD, monthKey, addMonthsKey } from '../js/dates.js';
import { parseWorkbook, parseLooseNumber } from '../js/parse.js';
import { futureValue, yearsToGoal } from '../js/projection.js';
import { levelFor, xpForLevel, applyUploadToChallenges, computeGame } from '../js/game.js';
import { fmtEur, fmtPct } from '../js/format.js';

// Load the vendored browser build of SheetJS.
const require = createRequire(import.meta.url);
const code = fs.readFileSync(fileURLToPath(new URL('../vendor/xlsx.full.min.js', import.meta.url)), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
const XLSX = mod.exports;

let failed = 0, passed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.error('FAIL:', msg); } }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- dates: serial -> month key, timezone independent ---
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
ok(monthKey(serialToYMD(serial(2026, 10, 1))) === '2026-10', '2026-10-01 stays 2026-10');
ok(monthKey(serialToYMD(serial(2026, 10, 1) + 0.999)) === '2026-10', 'time part does not roll the day');
ok(monthKey(serialToYMD(serial(2025, 1, 1))) === '2025-01', 'January');
ok(monthKey(serialToYMD(serial(2024, 2, 29))) === '2024-02', 'leap day');
ok(addMonthsKey('2026-11', 2) === '2027-01', 'add months over year end');
ok(addMonthsKey('2026-01', -1) === '2025-12', 'subtract months over year start');

// --- loose number input ---
const cases = [['9,5', 9.5], ['9.5', 9.5], ['9 500', 9500], ['9,5 km', 9.5], ['95%', 0.95], ['12 345 €', 12345], ['5.678,9', 5678.9], ['5,678.9', 5678.9], ['−340', -340], ['abc', null]];
for (const [s, v] of cases) ok(parseLooseNumber(s) === v, `parseLooseNumber(${s}) = ${parseLooseNumber(s)}, expected ${v}`);

// --- format ---
ok(fmtEur(12345) === '12\u00a0345\u00a0€', 'pt-PT money');
ok(fmtPct(0.095) === '9,5%', 'pt-PT percent');

// --- projection math (Excel FV and NPER-style log formula) ---
const fv = futureValue({ pv: 1000, monthly: 100, annual: 0.12, years: 1 });
ok(near(fv, 1000 * 1.01 ** 12 + 100 * (1.01 ** 12 - 1) / 0.01), 'FV monthly compounding');
const y = yearsToGoal({ goal: fv, pv: 1000, monthly: 100, annual: 0.12 });
ok(near(y, 1, 1e-9), 'yearsToGoal inverts FV');
ok(yearsToGoal({ goal: 10, pv: 20, monthly: 0, annual: 0.05 }) === 0, 'already reached');
ok(yearsToGoal({ goal: 100, pv: 0, monthly: 0, annual: 0 }) === Infinity, 'never reached');

// --- levels ---
ok(xpForLevel(1) === 300 && xpForLevel(4) === 2400, 'level thresholds 300 n^1.5');
ok(levelFor(299).level === 0 && levelFor(300).level === 1, 'level boundary');

// --- end-to-end parse of an in-memory synthetic workbook ---
const wb = XLSX.utils.book_new();
const months = [serial(2026, 8, 1), serial(2026, 9, 1), serial(2026, 10, 1)];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Mês', 'Santander', 'NI T212', 'Trading212', 'NW', 'Me %', 'S&P %', 'Savings rate', 'Emergency months', 'Spending', 'Score', 'Rating'],
  [months[0], 100, 0, 900, 1000, null, null, null, 0, null, null, null],
  [months[1], 120, 50, 1000, 1170, 0.1, 0.02, 0.25, 0.5, 100, 3, 'Building'],
  [months[2], 150, 80, 1100, 1330, 0.05, 0.06, 0.15, 0.8, 90, 2, ''],
]), 'NW CF');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Mês', 'Supermercado', 'Fora de casa', 'Total despesa'],
  [months[1], 60, 40, 100], [months[2], 50, 40, 90],
]), 'DESPESAS');
const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
const data = parseWorkbook(XLSX, bytes);
ok(data.months.length === 3, 'three months parsed');
ok(data.months[2].key === '2026-10', `latest month is 2026-10 (got ${data.months[2].key})`);
ok(data.months[2].rating === 'Needs Attention', 'missing rating filled from the default thresholds');
ok(data.warnings.some((w) => w.includes('BASE')), 'missing sheet is reported, not fatal');

// --- challenges state machine ---
const first = applyUploadToChallenges(null, data, '2026-10-20T12:00:00');
ok(first.state.active && first.state.active.forMonth === '2026-11', 'challenges target the next month');
const same = applyUploadToChallenges(first.state, data, '2026-10-21T12:00:00');
ok(same.state.active.forMonth === '2026-11' && same.state.history.length === 0, 're-upload keeps active challenges');
const next = JSON.parse(JSON.stringify(data));
next.months.push({ ...next.months[2], key: '2026-11', savingsRate: 0.3, me: 0.01, sp: 0.0, score: 4 });
next.spend.months.push({ key: '2026-11', byCat: { Supermercado: 10, 'Fora de casa': 10 }, total: 20 });
const after = applyUploadToChallenges(same.state, next, '2026-12-02T12:00:00');
ok(after.state.history.length === 1 && after.state.history[0].items.every((i) => i.status !== 'active'), 'challenges evaluated on next upload');
ok(after.state.active.forMonth === '2026-12', 'new challenges generated');
const g = computeGame(next, { meta: { firstUploadAt: '2026-10-20T12:00:00' }, challenges: after.state });
ok(g.xp.challengeXP === 75 * g.completed.length, 'challenge XP is 75 each');
ok(g.badges.length >= 12 && g.badges.length <= 16, 'badge count in range');

console.log(`TZ=${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
