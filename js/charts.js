// Hand-written SVG charts. Thin marks, recessive axes, one y-axis, hover + keyboard readouts.
import { labelKeyTiny, labelKey } from './dates.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Registry of rendered charts, used by the hover/focus layer. */
export const chartRegistry = new Map();

function niceStep(range, count) {
  const raw = range / Math.max(count, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}
export function niceScale(min, max, count = 4) {
  if (min === max) { max = min + (Math.abs(min) || 1); }
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

function xTickIndexes(n, max = 4) {
  if (n <= max) return [...Array(n).keys()];
  const out = new Set([0, n - 1]);
  const step = (n - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) out.add(Math.round(i * step));
  return [...out].sort((a, b) => a - b);
}

const M = { l: 52, r: 14, t: 14, b: 28 };

/**
 * Line chart. series: [{name, values (null = gap), color}], keys = month keys.
 * opts: { id, w, h, fmt (tooltip), axisFmt, area (bool), zero (include 0), title, endLabel }
 */
export function lineChart({ id, keys, series, w, h = 210, fmt, axisFmt, area = false, zero = false, title, endLabel = true }) {
  w = Math.max(260, Math.round(w));
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  if (!all.length || keys.length < 2) return `<p class="empty-note">Not enough months to draw a chart yet.</p>`;
  let mn = Math.min(...all), mx = Math.max(...all);
  if (zero) { mn = Math.min(0, mn); mx = Math.max(0, mx); }
  const { lo, hi, ticks } = niceScale(mn, mx, 4);
  const iw = w - M.l - M.r, ih = h - M.t - M.b;
  const x = (i) => M.l + (keys.length === 1 ? iw / 2 : (i * iw) / (keys.length - 1));
  const y = (v) => M.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  let g = '';
  for (const t of ticks) {
    g += `<line class="grid${t === 0 ? ' base' : ''}" x1="${M.l}" x2="${w - M.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`;
    g += `<text class="axis" x="${M.l - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(axisFmt(t))}</text>`;
  }
  for (const i of xTickIndexes(keys.length, w < 330 ? 3 : 4)) {
    const anchor = i === 0 ? 'start' : i === keys.length - 1 ? 'end' : 'middle';
    g += `<text class="axis" x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="${anchor}">${esc(labelKeyTiny(keys[i]))}</text>`;
  }
  let marks = '';
  series.forEach((s) => {
    let d = '', started = false, lastI = -1;
    s.values.forEach((v, i) => {
      if (v == null) { started = false; return; }
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      started = true; lastI = i;
    });
    if (area && series.length === 1) {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      const base = y(Math.max(lo, Math.min(hi, 0 >= lo && 0 <= hi ? 0 : lo)));
      const ad = `M${pts[0][0].toFixed(1)},${base.toFixed(1)}` + pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') + `L${pts.at(-1)[0].toFixed(1)},${base.toFixed(1)}Z`;
      marks += `<path class="area" d="${ad}" style="fill:${s.color}"/>`;
    }
    marks += `<path class="line" d="${d}" style="stroke:${s.color}"/>`;
    if (lastI >= 0) marks += `<circle class="dot" cx="${x(lastI).toFixed(1)}" cy="${y(s.values[lastI]).toFixed(1)}" r="4.5" style="fill:${s.color}"/>`;
  });
  // Selective direct label: the end value of a single series.
  let labels = '';
  if (endLabel && series.length === 1) {
    const s = series[0], li = s.values.length - 1;
    if (s.values[li] != null) labels += `<text class="endlabel" x="${(x(li) - 8).toFixed(1)}" y="${(y(s.values[li]) - 12).toFixed(1)}" text-anchor="end">${esc(fmt(s.values[li]))}</text>`;
  }
  chartRegistry.set(id, { type: 'line', keys, series, xs: keys.map((_, i) => x(i)), top: M.t, bottom: M.t + ih, fmt, w, h });
  const aria = `${title}. ${keys.length} months from ${labelKey(keys[0])} to ${labelKey(keys.at(-1))}. Use left and right arrow keys to read each month.`;
  return `<div class="chart" data-chart="${id}">
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" tabindex="0" aria-label="${esc(aria)}">${g}${marks}${labels}
      <line class="cross" x1="0" x2="0" y1="${M.t}" y2="${M.t + ih}" visibility="hidden"/>
    </svg><div class="tt" role="status" aria-live="polite" hidden></div></div>`;
}

/** Stacked columns per month. series: [{name, values, color}] (non-negative parts). */
export function stackedBars({ id, keys, series, w, h = 220, fmt, axisFmt, title, totals }) {
  w = Math.max(260, Math.round(w));
  if (!keys.length) return `<p class="empty-note">No months to show yet.</p>`;
  const tot = keys.map((_, i) => totals ? totals[i] : series.reduce((s, se) => s + Math.max(0, se.values[i] ?? 0), 0));
  const { lo, hi, ticks } = niceScale(0, Math.max(...tot, 1), 4);
  const iw = w - M.l - M.r, ih = h - M.t - M.b;
  const band = iw / keys.length;
  const bw = Math.min(24, Math.max(6, band * 0.62));
  const y = (v) => M.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  let g = '';
  for (const t of ticks) {
    g += `<line class="grid${t === 0 ? ' base' : ''}" x1="${M.l}" x2="${w - M.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`;
    g += `<text class="axis" x="${M.l - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(axisFmt(t))}</text>`;
  }
  const cx = (i) => M.l + band * i + band / 2;
  for (const i of xTickIndexes(keys.length, w < 330 ? 3 : 4)) {
    const anchor = i === 0 ? 'start' : i === keys.length - 1 ? 'end' : 'middle';
    const tx = anchor === 'start' ? cx(i) - bw / 2 : anchor === 'end' ? cx(i) + bw / 2 : cx(i);
    g += `<text class="axis" x="${tx.toFixed(1)}" y="${h - 8}" text-anchor="${anchor}">${esc(labelKeyTiny(keys[i]))}</text>`;
  }
  let marks = '';
  const GAP = 2;
  keys.forEach((_, i) => {
    let acc = 0;
    const parts = series.map((s) => ({ v: Math.max(0, s.values[i] ?? 0), c: s.color })).filter((p) => p.v > 0);
    parts.forEach((p, j) => {
      const y0 = y(acc), y1 = y(acc + p.v);
      acc += p.v;
      const isTop = j === parts.length - 1;
      let top = y1 + (isTop ? 0 : GAP / 2), bot = y0 - (j === 0 ? 0 : GAP / 2);
      if (bot - top < 0.8) return;
      const x0 = cx(i) - bw / 2, r = isTop ? Math.min(4, (bot - top) / 2, bw / 2) : 0;
      const d = r > 0
        ? `M${x0},${bot}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${bot}Z`
        : `M${x0},${bot}V${top}H${x0 + bw}V${bot}Z`;
      marks += `<path class="seg" d="${d}" style="fill:${p.c}"/>`;
    });
  });
  chartRegistry.set(id, { type: 'bars', keys, series, xs: keys.map((_, i) => cx(i)), band, top: M.t, bottom: M.t + ih, fmt, totals: tot, w, h, bw });
  const aria = `${title}. ${keys.length} months from ${labelKey(keys[0])} to ${labelKey(keys.at(-1))}. Use left and right arrow keys to read each month.`;
  return `<div class="chart" data-chart="${id}">
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" tabindex="0" aria-label="${esc(aria)}">${g}${marks}
      <rect class="hover-band" x="0" y="${M.t}" width="${band.toFixed(1)}" height="${ih}" visibility="hidden"/>
    </svg><div class="tt" role="status" aria-live="polite" hidden></div></div>`;
}

/** Small trend line for lists: muted line, last point marked. */
export function sparkline(values, w = 64, h = 24) {
  const v = values.map((x) => (x == null ? null : x));
  const nums = v.filter((x) => x != null);
  if (nums.length < 2) return `<svg width="${w}" height="${h}" aria-hidden="true"></svg>`;
  const mn = Math.min(...nums), mx = Math.max(...nums);
  const x = (i) => 2 + (i * (w - 6)) / (v.length - 1);
  const y = (val) => h - 3 - ((val - mn) / (mx - mn || 1)) * (h - 6);
  let d = '', started = false, li = 0;
  v.forEach((val, i) => { if (val == null) { started = false; return; } d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`; started = true; li = i; });
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/><circle cx="${x(li).toFixed(1)}" cy="${y(v[li]).toFixed(1)}" r="2.5"/></svg>`;
}

/** Tooltip content for index i (values lead, names follow; line keys). */
function tooltipHTML(meta, i) {
  const rows = meta.series.map((s) => {
    const v = s.values[i];
    return `<div class="tt-row"><span class="tt-key" style="background:${s.color}"></span><b>${esc(v == null ? '–' : meta.fmt(v))}</b><span>${esc(s.name)}</span></div>`;
  }).join('');
  const total = meta.type === 'bars' && meta.series.length > 1 ? `<div class="tt-row tt-total"><span class="tt-key none"></span><b>${esc(meta.fmt(meta.totals[i]))}</b><span>Total</span></div>` : '';
  return `<div class="tt-title">${esc(labelKey(meta.keys[i]))}</div>${rows}${total}`;
}

/** Wire the hover / keyboard layer for every chart inside root (call after render). */
export function bindCharts(root) {
  root.querySelectorAll('.chart').forEach((el) => {
    const meta = chartRegistry.get(el.dataset.chart);
    if (!meta || el.dataset.bound) return;
    el.dataset.bound = '1';
    const svg = el.querySelector('svg'), tt = el.querySelector('.tt');
    let idx = -1;
    const show = (i) => {
      idx = Math.max(0, Math.min(meta.keys.length - 1, i));
      const xPos = meta.xs[idx];
      if (meta.type === 'line') {
        const c = svg.querySelector('.cross');
        c.setAttribute('x1', xPos); c.setAttribute('x2', xPos); c.setAttribute('visibility', 'visible');
      } else {
        const b = svg.querySelector('.hover-band');
        b.setAttribute('x', (xPos - meta.band / 2).toFixed(1)); b.setAttribute('visibility', 'visible');
      }
      tt.innerHTML = tooltipHTML(meta, idx);
      tt.hidden = false;
      const tw = tt.offsetWidth, cw = el.clientWidth;
      let left = xPos + 12;
      if (left + tw > cw) left = xPos - tw - 12;
      tt.style.transform = `translate(${Math.max(0, left).toFixed(0)}px, 4px)`;
    };
    const hide = () => {
      idx = -1; tt.hidden = true;
      svg.querySelector('.cross')?.setAttribute('visibility', 'hidden');
      svg.querySelector('.hover-band')?.setAttribute('visibility', 'hidden');
    };
    const nearest = (clientX) => {
      const r = svg.getBoundingClientRect();
      const px = (clientX - r.left) * (meta.w / r.width);
      let best = 0, bd = Infinity;
      meta.xs.forEach((xv, i) => { const d = Math.abs(xv - px); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
    svg.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { show(idx < 0 ? 0 : idx + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { show(idx < 0 ? meta.keys.length - 1 : idx - 1); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
    });
    svg.addEventListener('focus', () => show(meta.keys.length - 1));
  });
}

/** Data table for a chart (the accessible, no-hover view). */
export function dataTable({ keys, series, fmt, totals }) {
  const head = `<tr><th scope="col">Month</th>${series.map((s) => `<th scope="col">${esc(s.name)}</th>`).join('')}${totals ? '<th scope="col">Total</th>' : ''}</tr>`;
  const body = keys.map((k, i) => `<tr><th scope="row">${esc(labelKeyTiny(k))}</th>${series.map((s) => `<td>${esc(s.values[i] == null ? '–' : fmt(s.values[i]))}</td>`).join('')}${totals ? `<td>${esc(fmt(totals[i]))}</td>` : ''}</tr>`).reverse().join('');
  return `<div class="table-wrap"><table class="data">${head}${body}</table></div>`;
}
