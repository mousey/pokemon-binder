/* =========================================================================
   chart.js — tiny dependency-free SVG line chart.
   LineChart.render(el, series, { format }) where
     series = [{ name, color, points: [{ t: msTimestamp, v: number }] }]
   ========================================================================= */

const LineChart = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  }

  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  function render(container, series, opts = {}) {
    const format = opts.format || ((v) => v.toFixed(2));
    container.innerHTML = '';
    const pts = series.flatMap((s) => s.points);
    if (!pts.length) {
      container.innerHTML = `<div class="chart-empty">${opts.emptyText || 'No price history yet for this period.'}</div>`;
      return;
    }

    const W = 560, H = 240, P = { l: 58, r: 16, t: 16, b: 30 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg' }, container);

    let tMin = Math.min(...pts.map((p) => p.t)), tMax = Math.max(...pts.map((p) => p.t));
    if (tMin === tMax) { tMin -= 86400000; tMax += 86400000; }
    let vMin = Math.min(...pts.map((p) => p.v)), vMax = Math.max(...pts.map((p) => p.v));
    if (vMin === vMax) { vMin = vMin * 0.8; vMax = vMax * 1.2 || 1; }
    const pad = (vMax - vMin) * 0.12; vMin = Math.max(0, vMin - pad); vMax += pad;

    const x = (t) => P.l + ((t - tMin) / (tMax - tMin)) * (W - P.l - P.r);
    const y = (v) => H - P.b - ((v - vMin) / (vMax - vMin)) * (H - P.t - P.b);

    // grid + y labels
    for (let i = 0; i <= 4; i++) {
      const v = vMin + ((vMax - vMin) * i) / 4;
      el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'chart-grid' }, svg);
      const tx = el('text', { x: P.l - 8, y: y(v) + 4, class: 'chart-label', 'text-anchor': 'end' }, svg);
      tx.textContent = format(v);
    }
    // x labels
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const t = tMin + ((tMax - tMin) * i) / ticks;
      const tx = el('text', { x: x(t), y: H - 8, class: 'chart-label', 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' }, svg);
      tx.textContent = fmtDate(t);
    }

    series.forEach((s, si) => {
      const sp = [...s.points].sort((a, b) => a.t - b.t);
      if (!sp.length) return;
      const d = sp.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
      if (sp.length > 1) {
        const gid = `g${Math.random().toString(36).slice(2)}`;
        const defs = el('defs', {}, svg);
        const lg = el('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
        el('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': si === 0 ? 0.35 : 0.15 }, lg);
        el('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': 0 }, lg);
        el('path', { d: `${d} L${x(sp.at(-1).t)},${H - P.b} L${x(sp[0].t)},${H - P.b} Z`, fill: `url(#${gid})` }, svg);
        el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'chart-line' }, svg);
      }
      sp.forEach((p) => {
        const c = el('circle', { cx: x(p.t), cy: y(p.v), r: 4.5, fill: '#fff', stroke: s.color, 'stroke-width': 2.5, class: 'chart-dot' }, svg);
        const title = el('title', {}, c);
        title.textContent = `${s.name} • ${fmtDate(p.t)} • ${format(p.v)}`;
      });
    });

    if (series.length > 1 || opts.legend) {
      const lg = document.createElement('div');
      lg.className = 'chart-legend';
      lg.innerHTML = series.filter((s) => s.points.length)
        .map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
      container.appendChild(lg);
    }
  }

  return { render };
})();
