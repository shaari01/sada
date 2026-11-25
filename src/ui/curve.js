import { h } from './dom.js';
/** Touch-friendly curve editor: points [{u (0..1), s}] with y in [min,max]. */
export function curveEditor({ points, min, max, ref = 1, fmt = (v) => v.toFixed(2), onChange }) {
  const cv = h('canvas', { class: 'curve-editor', 'data-testid': 'curve' });
  let pts = points.map((p) => ({ ...p })); let drag = null, lastTap = 0;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const geo = () => ({ W: cv.clientWidth, H: cv.clientHeight, pad: 18 });
  const toXY = (p) => { const { W, H, pad } = geo(); return [pad + p.u * (W - 2 * pad), pad + (1 - (p.s - min) / (max - min)) * (H - 2 * pad)]; };
  const fromXY = (x, y) => { const { W, H, pad } = geo(); return { u: Math.min(1, Math.max(0, (x - pad) / (W - 2 * pad))), s: Math.min(max, Math.max(min, min + (1 - (y - pad) / (H - 2 * pad)) * (max - min))) }; };
  const draw = () => {
    const dpr = devicePixelRatio || 1, { W, H, pad } = geo(); cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H); c.font = '12px system-ui'; c.fillStyle = css('--muted');
    for (const v of [min, ref, max]) { const y = toXY({ u: 0, s: v })[1]; c.strokeStyle = v === ref ? css('--muted') : css('--line'); c.setLineDash(v === ref ? [5, 5] : []); c.beginPath(); c.moveTo(pad, y); c.lineTo(W - pad, y); c.stroke(); c.fillText(fmt(v), 2, y - 3); }
    c.setLineDash([]); c.strokeStyle = css('--accent'); c.lineWidth = 3; c.beginPath(); pts.forEach((p, i) => { const [x, y] = toXY(p); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    for (const p of pts) { const [x, y] = toXY(p); c.fillStyle = css('--accent'); c.beginPath(); c.arc(x, y, 10, 0, 7); c.fill(); c.fillStyle = css('--text'); c.fillText(fmt(p.s), x - 12, y - 14); }
  };
  const sorted = () => pts.sort((a, b) => a.u - b.u);
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId); const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    let i = pts.findIndex((p) => { const [px, py] = toXY(p); return Math.hypot(px - x, py - y) < 26; });
    const now = performance.now();
    if (i >= 0 && now - lastTap < 380 && pts.length > 2 && i > 0 && i < pts.length - 1) { pts.splice(i, 1); draw(); onChange?.(pts); return; }
    lastTap = now;
    if (i < 0) { pts.push(fromXY(x, y)); sorted(); i = pts.findIndex((p) => Math.abs(toXY(p)[0] - x) < 1); }
    drag = i; draw(); onChange?.(pts);
  });
  cv.addEventListener('pointermove', (e) => { if (drag == null || drag < 0) return; const r = cv.getBoundingClientRect(); const np = fromXY(e.clientX - r.left, e.clientY - r.top); const p = pts[drag]; p.s = Math.round(np.s * 100) / 100; if (drag > 0 && drag < pts.length - 1) p.u = Math.min(pts[drag + 1].u - 0.01, Math.max(pts[drag - 1].u + 0.01, np.u)); draw(); onChange?.(pts); });
  cv.addEventListener('pointerup', () => (drag = null));
  new ResizeObserver(draw).observe(cv);
  cv.get = () => pts.map((p) => ({ ...p })); cv.set = (np) => { pts = np.map((p) => ({ ...p })); draw(); };
  return cv;
}
