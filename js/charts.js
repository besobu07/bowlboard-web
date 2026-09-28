/* BowlBoard trend charts — inline SVG, no library.
 *
 *   scoreTrend(el, games)  every game as a dot + a 10-game rolling average line
 *   rateTrend(el, games)   strike % and spare % per week (or per month once the
 *                          history spans ~3 months); one 0-100% axis
 *
 * Each chart gets a hover/keyboard readout (crosshair + tooltip; arrow keys move
 * it), a legend, direct labels on line ends, and a "Show as table" view, so no
 * value is only reachable by hovering or by colour. Colours come from CSS tokens
 * (--series-1 / --series-2 / --viz-*), validated for colour-blind separation and
 * contrast on the app's dark card surface.
 */
(function (global) {
  'use strict';
  const S = global.BBScore;
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtShort = iso => { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const fmtMonth = key => { const d = new Date(key + '-01T12:00:00'); return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }); };

  function chrono(games) {
    return games.filter(g => g.total != null && g.date).slice().sort((a, b) =>
      a.date.localeCompare(b.date) || (a.seriesId || '').localeCompare(b.seriesId || '') || (a.gameNo || 1) - (b.gameNo || 1));
  }
  function niceTicks(lo, hi) {
    const step = hi - lo > 150 ? 50 : 25;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  }
  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, str, cls, anchor) {
    const t = el('text', { x, y, class: cls || 'viz-label', 'text-anchor': anchor || 'start' }, parent);
    t.textContent = str;
    return t;
  }

  // Shared frame: wrapper with legend, svg, tooltip and table.
  function frame(host, opts) {
    host.innerHTML = '';
    host.classList.add('viz');
    const legend = document.createElement('div');
    legend.className = 'viz-legend';
    legend.innerHTML = opts.legend.map(l => '<span><i class="sw sw-' + l.kind + '" style="--c:var(' + l.color + ')"></i>' + esc(l.label) + '</span>').join('');
    host.appendChild(legend);
    const wrap = document.createElement('div');
    wrap.className = 'viz-plot';
    host.appendChild(wrap);
    const W = Math.max(260, Math.round(wrap.clientWidth || host.clientWidth || 320)), H = opts.height || 190;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img', tabindex: '0', 'aria-label': opts.summary, focusable: 'true' });
    wrap.appendChild(svg);
    const tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.hidden = true;
    wrap.appendChild(tip);
    const details = document.createElement('details');
    details.className = 'viz-table';
    details.innerHTML = '<summary>Show as table</summary><div class="table-wrap"><table class="split">' + opts.table + '</table></div>';
    host.appendChild(details);
    return { svg, tip, W, H, wrap };
  }

  // Crosshair + tooltip; points: [{x, rows:[{label, value, strong}], title}]
  function hover(f, points, plot, onMove) {
    const { svg, tip } = f;
    const hair = el('line', { class: 'viz-hair', y1: plot.top, y2: plot.bottom, x1: plot.left, x2: plot.left, visibility: 'hidden' }, svg);
    const hit = el('rect', { x: plot.left - 6, y: 0, width: plot.right - plot.left + 12, height: f.H, fill: 'transparent' }, svg);
    let cur = -1;
    const showAt = i => {
      if (i < 0 || i >= points.length) return;
      cur = i;
      const p = points[i];
      hair.setAttribute('x1', p.x); hair.setAttribute('x2', p.x); hair.setAttribute('visibility', 'visible');
      if (onMove) onMove(i);
      tip.textContent = '';
      const strong = document.createElement('strong'); strong.textContent = p.value; tip.appendChild(strong);
      p.rows.forEach(r => { const d = document.createElement('div'); d.textContent = r; tip.appendChild(d); });
      tip.hidden = false;
      const tw = tip.offsetWidth || 120;
      const px = (p.x / f.W) * f.wrap.clientWidth;
      tip.style.left = Math.min(Math.max(0, px - tw / 2), f.wrap.clientWidth - tw) + 'px';
    };
    const hide = () => { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); if (onMove) onMove(-1); cur = -1; };
    const nearest = clientX => {
      const r = svg.getBoundingClientRect();
      const x = (clientX - r.left) * (f.W / r.width);
      let best = 0, bd = Infinity;
      points.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    hit.addEventListener('pointermove', e => showAt(nearest(e.clientX)));
    hit.addEventListener('pointerdown', e => showAt(nearest(e.clientX)));
    hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); showAt(cur < 0 ? points.length - 1 : Math.min(points.length - 1, cur + 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); showAt(cur < 0 ? points.length - 1 : Math.max(0, cur - 1)); }
      else if (e.key === 'Escape') hide();
    });
    svg.addEventListener('blur', hide);
  }

  /* ---------- scores over time ---------- */
  function scoreTrend(host, games) {
    const list = chrono(games);
    if (list.length < 3) { host.innerHTML = '<p class="small muted">Your score trend appears after three games.</p>'; return false; }
    const N = 10;
    const pts = list.map((g, i) => {
      const win = list.slice(Math.max(0, i - N + 1), i + 1);
      return { g, score: g.total, avg: win.reduce((a, x) => a + x.total, 0) / win.length };
    });
    const scores = pts.map(p => p.score);
    const lo = Math.max(0, Math.floor((Math.min(...scores) - 10) / 25) * 25);
    const hi = Math.min(300, Math.ceil((Math.max(...scores) + 10) / 25) * 25);
    const last = pts[pts.length - 1];
    const table = '<tr><th>Date</th><th>Game</th><th>Score</th><th>10-game avg</th></tr>' +
      pts.slice().reverse().slice(0, 40).map(p => '<tr><td>' + esc(fmtShort(p.g.date)) + '</td><td>' + (p.g.gameNo || 1) + '</td><td>' + p.score + '</td><td>' + Math.floor(p.avg) + '</td></tr>').join('');
    const f = frame(host, {
      legend: [{ kind: 'dot', color: '--viz-dot', label: 'Game score' }, { kind: 'line', color: '--series-1', label: N + '-game average' }],
      summary: 'Scores for ' + list.length + ' games from ' + fmtShort(list[0].date) + ' to ' + fmtShort(last.g.date) + '. Latest ' + N + '-game average ' + Math.floor(last.avg) + '.',
      table,
    });
    const plot = { left: 34, right: f.W - 58, top: 10, bottom: f.H - 24 };
    const x = i => plot.left + (pts.length === 1 ? 0 : i * (plot.right - plot.left) / (pts.length - 1));
    const y = v => plot.bottom - (v - lo) / (hi - lo) * (plot.bottom - plot.top);
    const g = el('g', {}, f.svg);
    niceTicks(lo, hi).forEach(v => {
      el('line', { class: 'viz-grid', x1: plot.left, x2: plot.right, y1: y(v), y2: y(v) }, g);
      text(g, plot.left - 6, y(v) + 4, String(v), 'viz-axis', 'end');
    });
    // x labels: first, middle, last date
    [0, Math.floor((pts.length - 1) / 2), pts.length - 1].filter((v, i, a) => a.indexOf(v) === i).forEach((i, k, arr) => {
      text(g, x(i), f.H - 6, fmtShort(pts[i].g.date), 'viz-axis', k === 0 ? 'start' : k === arr.length - 1 ? 'end' : 'middle');
    });
    const r = pts.length > 90 ? 2.5 : pts.length > 45 ? 3 : 4;
    pts.forEach((p, i) => el('circle', { class: 'viz-dot', cx: x(i), cy: y(p.score), r }, g));
    el('path', { class: 'viz-line s1', d: pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.avg).toFixed(1)).join(' ') }, g);
    el('circle', { class: 'viz-end s1', cx: x(pts.length - 1), cy: y(last.avg), r: 4 }, g);
    text(g, x(pts.length - 1) + 8, y(last.avg) + 4, 'avg ' + Math.floor(last.avg), 'viz-label strong');
    const focus = el('circle', { class: 'viz-focus', cx: plot.left, cy: plot.top, r: r + 2, visibility: 'hidden' }, g);
    hover(f, pts.map((p, i) => ({
      x: x(i), value: String(p.score),
      rows: [fmtShort(p.g.date) + ' · game ' + (p.g.gameNo || 1) + (p.g.sheet ? ' · league sheet' : ''), N + '-game average ' + Math.floor(p.avg)],
    })), plot, i => { if (i < 0) { focus.setAttribute('visibility', 'hidden'); return; } focus.setAttribute('visibility', 'visible'); focus.setAttribute('cx', x(i)); focus.setAttribute('cy', y(pts[i].score)); });
    return true;
  }

  /* ---------- strike % and spare % by week / month ---------- */
  function weekStart(iso) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function rateTrend(host, games) {
    const list = chrono(games.filter(g => g.frames));
    if (!list.length) { host.innerHTML = ''; return false; }
    const spanDays = (new Date(list[list.length - 1].date) - new Date(list[0].date)) / 864e5;
    const byMonth = spanDays >= 84;
    const buckets = new Map();
    list.forEach(g => {
      const k = byMonth ? g.date.slice(0, 7) : weekStart(g.date);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(g);
    });
    if (buckets.size < 2) { host.innerHTML = '<p class="small muted">Strike and spare trends appear once you have pin-by-pin games in two different weeks.</p>'; return false; }
    const rows = Array.from(buckets.entries()).map(([k, gs]) => {
      const st = S.pinStats(gs);
      return { k, label: byMonth ? fmtMonth(k) : 'wk of ' + fmtShort(k), short: byMonth ? fmtMonth(k) : fmtShort(k), n: gs.length,
        strike: st.racks ? 100 * st.strikes / st.racks : null, spare: st.spareOpps ? 100 * st.spares / st.spareOpps : null };
    });
    const pct = v => (v == null ? '—' : Math.round(v) + '%');
    const table = '<tr><th>' + (byMonth ? 'Month' : 'Week of') + '</th><th>Games</th><th>Strike %</th><th>Spare %</th></tr>' +
      rows.slice().reverse().map(r => '<tr><td>' + esc(r.short) + '</td><td>' + r.n + '</td><td>' + pct(r.strike) + '</td><td>' + pct(r.spare) + '</td></tr>').join('');
    const f = frame(host, {
      legend: [{ kind: 'line', color: '--series-1', label: 'Strike %' }, { kind: 'line', color: '--series-2', label: 'Spare %' }],
      summary: 'Strike and spare percentage by ' + (byMonth ? 'month' : 'week') + ' over ' + rows.length + ' ' + (byMonth ? 'months' : 'weeks') + '. Latest: strike ' + pct(rows[rows.length - 1].strike) + ', spare ' + pct(rows[rows.length - 1].spare) + '.',
      table, height: 180,
    });
    const plot = { left: 34, right: f.W - 72, top: 10, bottom: f.H - 24 };
    const x = i => plot.left + i * (plot.right - plot.left) / (rows.length - 1);
    const y = v => plot.bottom - v / 100 * (plot.bottom - plot.top);
    const g = el('g', {}, f.svg);
    [0, 25, 50, 75, 100].forEach(v => {
      el('line', { class: 'viz-grid', x1: plot.left, x2: plot.right, y1: y(v), y2: y(v) }, g);
      text(g, plot.left - 6, y(v) + 4, v + '%', 'viz-axis', 'end');
    });
    const labelEvery = Math.ceil(rows.length / 5);
    rows.forEach((r, i) => { if (i % labelEvery === 0 || i === rows.length - 1) text(g, x(i), f.H - 6, r.short, 'viz-axis', i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'); });
    const ends = [];
    [['strike', 's1', 'Strike'], ['spare', 's2', 'Spare']].forEach(([key, cls, name]) => {
      const seg = rows.map((r, i) => (r[key] == null ? null : [x(i), y(r[key])]));
      let d = '', pen = false;
      seg.forEach(p => { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' '; pen = true; });
      el('path', { class: 'viz-line ' + cls, d }, g);
      seg.forEach(p => { if (p) el('circle', { class: 'viz-mark ' + cls, cx: p[0], cy: p[1], r: 4 }, g); });
      const lastP = seg.filter(Boolean).pop();
      const lastV = rows.map(r => r[key]).filter(v => v != null).pop();
      if (lastP) ends.push({ y: lastP[1], x: lastP[0], str: name + ' ' + pct(lastV) });
    });
    // direct labels at the line ends, nudged apart if they'd collide
    ends.sort((a, b) => a.y - b.y);
    if (ends.length === 2 && ends[1].y - ends[0].y < 14) { const mid = (ends[0].y + ends[1].y) / 2; ends[0].y = mid - 7; ends[1].y = mid + 7; }
    ends.forEach(e => text(g, e.x + 8, e.y + 4, e.str, 'viz-label strong'));
    hover(f, rows.map((r, i) => ({ x: x(i), value: r.label, rows: ['Strike ' + pct(r.strike) + ' · spare ' + pct(r.spare), r.n + ' game' + (r.n === 1 ? '' : 's') + ' pin by pin'] })), plot);
    return true;
  }

  global.BBCharts = { scoreTrend, rateTrend };
})(typeof window !== 'undefined' ? window : globalThis);
