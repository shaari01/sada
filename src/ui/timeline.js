import { h, fmtTime } from './dom.js';
import { minMax } from './peaks.js';
import { clipEnd, projectDuration, activeTrack } from '../core/project.js';
import { envValueAt } from '../core/envelope.js';

const VMAX = 1.5; // envelope display range 0..150%
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export class Timeline {
  constructor(root, opts) {
    Object.assign(this, opts); // getProject, getSource, state, player, callbacks
    this.mode = 'single'; this.tool = 'select'; this.pps = 50; this.scroll = 0; this.laneH = 128;
    this.root = root; root.classList.add('timeline');
    this.overview = h('canvas', { class: 'tl-overview', 'aria-label': 'نظرة عامة على المقطع' });
    this.ruler = h('canvas', { class: 'tl-ruler', 'aria-label': 'المسطرة الزمنية' });
    this.headers = h('div', { class: 'tl-headers' });
    this.base = h('canvas', { class: 'tl-base' });
    this.over = h('canvas', { class: 'tl-over', 'data-testid': 'wave' });
    this.wrap = h('div', { class: 'tl-wrap', dir: 'ltr' }, this.base, this.over);
    this.body = h('div', { class: 'tl-body' }, this.headers, this.wrap);
    this.empty = h('div', { class: 'tl-empty' });
    root.append(this.overview, h('div', { class: 'tl-ruler-row' }, h('div', { class: 'tl-ruler-pad' }), this.ruler), this.body, this.empty);
    this.pointers = new Map();
    this._bind();
    new ResizeObserver(() => this.layout()).observe(root);
  }
  get project() { return this.getProject(); }
  tracksShown() { const p = this.project; if (!p) return []; return this.mode === 'single' ? [activeTrack(p)] : p.tracks; }
  timeAt(x) { return this.scroll + x / this.pps; }
  xAt(t) { return (t - this.scroll) * this.pps; }
  duration() { return Math.max(projectDuration(this.project || { tracks: [] }), 1); }
  setMode(m) { this.mode = m; this.root.dataset.mode = m; this.layout(); }
  fit() { const w = this.wrap.clientWidth || 300; this.pps = Math.max(1, (w - 8) / this.duration()); this.scroll = 0; this.redraw(); }
  zoom(f, centerT) {
    const w = this.wrap.clientWidth; const c = centerT ?? (this.state.selection ? (this.state.selection[0] + this.state.selection[1]) / 2 : this.timeAt(w / 2));
    const cx = this.xAt(c);
    const minPps = Math.max(0.5, (w - 8) / this.duration() / 2);
    this.pps = Math.min(30000, Math.max(minPps, this.pps * f));
    this.scroll = Math.max(0, c - cx / this.pps); this.redraw();
  }
  scrollTo(t) { this.scroll = Math.max(0, Math.min(t, this.duration() - this.wrap.clientWidth / this.pps / 2)); this.redraw(); }
  ensureVisible(t) { const w = this.wrap.clientWidth / this.pps; if (t < this.scroll || t > this.scroll + w * 0.95) this.scrollTo(t - w * 0.1); }

  layout() {
    const dpr = window.devicePixelRatio || 1; this.dpr = dpr;
    const tracks = this.tracksShown();
    const w = this.wrap.clientWidth || 300;
    let hgt;
    if (this.mode === 'single') { hgt = Math.max(160, this.body.clientHeight - 2); this.laneH = hgt; }
    else { this.laneH = window.innerWidth < 600 ? 104 : 128; hgt = Math.max(this.laneH, tracks.length * this.laneH); }
    for (const c of [this.base, this.over]) { c.width = w * dpr; c.height = hgt * dpr; c.style.width = w + 'px'; c.style.height = hgt + 'px'; }
    this.wrap.style.height = hgt + 'px';
    for (const [c, ch] of [[this.ruler, 30], [this.overview, 26]]) { const cw = c.clientWidth || w; c.width = cw * dpr; c.height = ch * dpr; }
    this.renderHeaders?.(this.headers, tracks, this.laneH);
    this.redraw();
  }
  redraw() { cancelAnimationFrame(this._rq); this._rq = requestAnimationFrame(() => { this.drawBase(); this.drawOverlay(); this.drawRuler(); this.drawOverview(); }); }
  redrawOverlay() { this.drawOverlay(); this.drawOverview(); }

  drawBase() {
    const p = this.project, c = this.base.getContext('2d'), dpr = this.dpr; if (!p) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = this.base.width / dpr, H = this.base.height / dpr;
    c.clearRect(0, 0, W, H);
    const tracks = this.tracksShown();
    const hasAudio = p.tracks.some((t) => t.clips.length);
    this.empty.hidden = hasAudio; this.empty.textContent = hasAudio ? '' : 'افتح ملفًا صوتيًا للبدء: اضغط «فتح ملف» أو اسحب الملف هنا';
    const accent = css('--accent'), wave = css('--wave'), laneBg = css('--lane'), laneAlt = css('--lane-alt'), clipBg = css('--clip');
    tracks.forEach((tr, li) => {
      const y0 = li * this.laneH, lh = this.laneH;
      c.fillStyle = tr.id === p.activeTrackId && this.mode === 'multi' ? laneAlt : laneBg; c.fillRect(0, y0, W, lh);
      // beat grid
      if (p.grid && p.bpm) {
        const beat = 60 / p.bpm; const t0 = Math.max(p.beatOffset, p.beatOffset + Math.floor((this.scroll - p.beatOffset) / beat) * beat);
        if (beat * this.pps > 6) for (let t = t0, k = Math.round((t0 - p.beatOffset) / beat); t < this.timeAt(W); t += beat, k++) { const x = Math.round(this.xAt(t)) + 0.5; c.strokeStyle = k % 4 === 0 ? css('--grid-strong') : css('--grid'); c.lineWidth = 1; c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 + lh); c.stroke(); }
      }
      for (const cl of tr.clips) {
        const x0 = this.xAt(cl.start), x1 = this.xAt(clipEnd(cl));
        if (x1 < 0 || x0 > W) continue;
        const sel = cl.id === this.state.selectedClipId;
        c.fillStyle = clipBg; c.globalAlpha = 1; roundRect(c, x0, y0 + 3, x1 - x0, lh - 6, 6); c.fill();
        c.fillStyle = tr.color; c.globalAlpha = 0.18; roundRect(c, x0, y0 + 3, x1 - x0, lh - 6, 6); c.fill(); c.globalAlpha = 1;
        if (sel || this.mode === 'multi') { c.strokeStyle = sel ? accent : tr.color; c.lineWidth = sel ? 3 : 1; roundRect(c, x0, y0 + 3, x1 - x0, lh - 6, 6); c.stroke(); }
        const src = this.getSource(cl.sourceId); if (!src) continue;
        const sr = src.sampleRate, mid = y0 + lh / 2, amp = (lh - 12) / 2 * (cl.gain ?? 1);
        c.fillStyle = this.mode === 'multi' ? tr.color : wave;
        const xs = Math.max(0, Math.floor(x0)), xe = Math.min(W, Math.ceil(x1));
        for (let x = xs; x < xe; x++) {
          const ta = this.timeAt(x) - cl.start + cl.offset, tb = ta + 1 / this.pps;
          const mm = minMax(src, ta * sr, tb * sr); if (!mm) continue;
          const yt = mid - Math.min(1, mm[1]) * amp, yb = mid - Math.max(-1, mm[0]) * amp;
          c.fillRect(x, yt, 1, Math.max(1, yb - yt));
        }
        // fades
        c.strokeStyle = css('--fade'); c.lineWidth = 2;
        if (cl.fadeIn > 0) { c.beginPath(); c.moveTo(x0, y0 + lh - 4); c.lineTo(this.xAt(cl.start + cl.fadeIn), y0 + 4); c.stroke(); }
        if (cl.fadeOut > 0) { c.beginPath(); c.moveTo(this.xAt(clipEnd(cl) - cl.fadeOut), y0 + 4); c.lineTo(x1, y0 + lh - 4); c.stroke(); }
      }
      // envelope
      if (tr.envelope.length || this.tool === 'envelope') {
        const yv = (v) => y0 + 4 + (1 - v / VMAX) * (lh - 8);
        c.setLineDash([4, 4]); c.strokeStyle = css('--muted'); c.lineWidth = 1; c.beginPath(); c.moveTo(0, yv(1)); c.lineTo(W, yv(1)); c.stroke(); c.setLineDash([]);
        c.strokeStyle = css('--env'); c.lineWidth = 2.5; c.beginPath();
        for (let x = 0; x <= W; x += 2) { const v = envValueAt(tr.envelope, this.timeAt(x)); x === 0 ? c.moveTo(x, yv(v)) : c.lineTo(x, yv(v)); }
        c.stroke();
        if (this.tool === 'envelope' || this.mode === 'single') for (const pt of tr.envelope) { const x = this.xAt(pt.t); if (x < -10 || x > W + 10) continue; c.fillStyle = css('--env'); c.beginPath(); c.arc(x, yv(pt.v), this.tool === 'envelope' ? 9 : 5, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); }
      }
      c.fillStyle = css('--line'); c.fillRect(0, y0 + lh - 1, W, 1);
    });
  }
  laneOf(trackId) { return this.tracksShown().findIndex((t) => t.id === trackId); }
  drawOverlay() {
    const p = this.project, c = this.over.getContext('2d'), dpr = this.dpr; if (!p) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = this.over.width / dpr, H = this.over.height / dpr; c.clearRect(0, 0, W, H);
    const s = this.state.selection;
    if (s && s[1] > s[0]) {
      const li = this.mode === 'single' ? 0 : this.laneOf(p.activeTrackId);
      if (li >= 0) {
        const x0 = this.xAt(s[0]), x1 = this.xAt(s[1]), y0 = li * this.laneH;
        c.fillStyle = css('--sel'); c.fillRect(x0, y0, x1 - x0, this.laneH);
        c.fillStyle = css('--accent');
        for (const x of [x0, x1]) { c.fillRect(x - 1, y0, 2, this.laneH); c.beginPath(); c.arc(x, y0 + this.laneH - 14, 11, 0, Math.PI * 2); c.fill(); }
      }
    }
    for (const m of p.markers) { const x = this.xAt(m.t); if (x < 0 || x > W) continue; c.fillStyle = css('--marker'); c.fillRect(x - 1, 0, 2, H); }
    const cx = this.xAt(this.state.cursor); c.fillStyle = css('--cursor'); c.fillRect(cx - 1, 0, 2, H);
    const pos = this.player.position();
    if (pos != null && !this.player.preview) { const px = this.xAt(pos); c.fillStyle = css('--playhead'); c.fillRect(px - 1.5, 0, 3, H); }
  }
  drawRuler() {
    const c = this.ruler.getContext('2d'), dpr = this.dpr, W = this.ruler.width / dpr, H = this.ruler.height / dpr; const p = this.project; if (!p) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    c.fillStyle = css('--panel'); c.fillRect(0, 0, W, H);
    const steps = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((s) => s * this.pps >= 70) || 600;
    c.fillStyle = css('--text'); c.strokeStyle = css('--muted'); c.font = '12px system-ui, sans-serif'; c.textBaseline = 'top';
    const t0 = Math.floor(this.scroll / step) * step;
    for (let t = t0; t < this.timeAt(W); t += step) { const x = Math.round(this.xAt(t)) + 0.5; c.beginPath(); c.moveTo(x, H - 10); c.lineTo(x, H); c.stroke(); c.fillText(fmtTime(t, step < 1), x + 3, 3); }
    for (const m of p.markers) { const x = this.xAt(m.t); if (x < -100 || x > W) continue; c.fillStyle = css('--marker'); c.fillRect(x, 0, 3, H); const tw = c.measureText(m.name).width + 10; c.fillRect(x, 14, tw, 16); c.fillStyle = '#fff'; c.fillText(m.name, x + 5, 15); }
  }
  drawOverview() {
    const c = this.overview.getContext('2d'), dpr = this.dpr, W = this.overview.width / dpr, H = this.overview.height / dpr; const p = this.project; if (!p) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); c.fillStyle = css('--panel'); c.fillRect(0, 0, W, H);
    const D = this.duration(), k = W / D; const tr = activeTrack(p);
    c.fillStyle = css('--wave'); c.globalAlpha = 0.5;
    for (const cl of tr.clips) c.fillRect(cl.start * k, 6, cl.duration * k, H - 12);
    c.globalAlpha = 1;
    // viewport (LTR time; overview is LTR as well)
    const vw = (this.wrap.clientWidth / this.pps) * k;
    c.strokeStyle = css('--accent'); c.lineWidth = 2; c.strokeRect(this.scroll * k + 1, 1, Math.max(6, vw - 2), H - 2);
    const pos = this.player.position(); if (pos != null) { c.fillStyle = css('--playhead'); c.fillRect(pos * k, 0, 2, H); }
    c.fillStyle = css('--cursor'); c.fillRect(this.state.cursor * k, 0, 2, H);
  }

  // ---------------- interaction ----------------
  _local(e, el = this.over) { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  _bind() {
    const o = this.over;
    o.style.touchAction = 'none';
    o.addEventListener('pointerdown', (e) => this._down(e));
    o.addEventListener('pointermove', (e) => this._move(e));
    o.addEventListener('pointerup', (e) => this._up(e));
    o.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.drag = null; });
    o.addEventListener('wheel', (e) => { e.preventDefault(); if (e.ctrlKey || e.metaKey) { const { x } = this._local(e); this.zoom(e.deltaY < 0 ? 1.25 : 0.8, this.timeAt(x)); } else { const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; this.scroll = Math.max(0, this.scroll + d / this.pps); this.redraw(); } }, { passive: false });
    // overview drag → scroll
    const ov = this.overview; ov.style.touchAction = 'none';
    const ovMove = (e) => { const { x } = this._local(e, ov); const D = this.duration(); const vw = this.wrap.clientWidth / this.pps; this.scroll = Math.max(0, (x / ov.clientWidth) * D - vw / 2); this.redraw(); };
    ov.addEventListener('pointerdown', (e) => { ov.setPointerCapture(e.pointerId); ovMove(e); ov.onpointermove = ovMove; });
    ov.addEventListener('pointerup', () => (ov.onpointermove = null));
    // ruler tap → cursor or marker
    const ru = this.ruler; ru.style.touchAction = 'none';
    ru.addEventListener('pointerdown', (e) => { const { x } = this._local(e, ru); const t = this.timeAt(x); const m = this.project.markers.find((m) => Math.abs(this.xAt(m.t) - x) < 16 || (x >= this.xAt(m.t) && x <= this.xAt(m.t) + 80 && this._local(e, ru).y > 12)); if (m) this.onMarkerTap?.(m); else this.onCursor?.(Math.max(0, t), true); });
  }
  _hitClip(x, y) {
    const li = Math.floor(y / this.laneH); const tr = this.tracksShown()[li]; if (!tr) return null;
    const t = this.timeAt(x); const cl = [...tr.clips].reverse().find((c) => t >= c.start && t <= clipEnd(c));
    return cl ? { track: tr, clip: cl, lane: li } : { track: tr, clip: null, lane: li };
  }
  _snap(t, exceptClipId) {
    const p = this.project; let best = t, bd = 14 / this.pps;
    if (p.grid && p.bpm) { const beat = 60 / p.bpm; const k = Math.round((t - p.beatOffset) / beat); const g = p.beatOffset + k * beat; if (Math.abs(g - t) < bd * 2) { best = g; bd = Math.abs(g - t); } }
    if (this.magnet !== false) for (const tr of p.tracks) for (const c of tr.clips) { if (c.id === exceptClipId) continue; for (const e of [c.start, clipEnd(c)]) if (Math.abs(e - t) < bd) { best = e; bd = Math.abs(e - t); } }
    return best;
  }
  _down(e) {
    this.over.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this._local(e));
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, pps: this.pps, cx: (a.x + b.x) / 2, t: this.timeAt((a.x + b.x) / 2) };
      this.drag = null; return;
    }
    const { x, y } = this._local(e);
    const t = Math.max(0, this.timeAt(x)), hit = this._hitClip(x, y);
    const p = this.project; if (!hit) return;
    const now = performance.now();
    if (this.tool === 'envelope') {
      const tr = hit.track, y0 = hit.lane * this.laneH, lh = this.laneH;
      const yv = (v) => y0 + 4 + (1 - v / VMAX) * (lh - 8);
      const idx = tr.envelope.findIndex((pt) => Math.hypot(this.xAt(pt.t) - x, yv(pt.v) - y) < 24);
      const vAt = (yy) => Math.max(0, Math.min(VMAX, (1 - (yy - y0 - 4) / (lh - 8)) * VMAX));
      if (idx >= 0 && this._lastTap && now - this._lastTap.time < 380 && this._lastTap.idx === idx) { this.onEnvelopeEdit?.(tr.id, 'delete', idx); this._lastTap = null; return; }
      this.drag = { kind: 'env', track: tr, idx, startX: x, startY: y, vAt, moved: false, t, y0 };
      this._lastTap = { time: now, idx };
      return;
    }
    if (this.tool === 'move' && hit.clip) {
      this.drag = { kind: 'clip', clip: hit.clip, track: hit.track, startX: x, startY: y, origStart: hit.clip.start, lane: hit.lane, moved: false };
      this.state.selectedClipId = hit.clip.id; this.onTrackActivate?.(hit.track.id); return;
    }
    if (hit.track.id !== p.activeTrackId) this.onTrackActivate?.(hit.track.id);
    const s = this.state.selection;
    if (s && s[1] > s[0]) {
      if (Math.abs(this.xAt(s[0]) - x) < 22) { this.drag = { kind: 'edge', which: 0, moved: true }; return; }
      if (Math.abs(this.xAt(s[1]) - x) < 22) { this.drag = { kind: 'edge', which: 1, moved: true }; return; }
    }
    this.drag = { kind: 'sel', t0: t, startX: x, moved: false, clip: hit.clip };
  }
  _move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, this._local(e));
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2;
      this.pps = Math.min(30000, Math.max(0.5, this.pinch.pps * (d / this.pinch.d)));
      this.scroll = Math.max(0, this.pinch.t - cx / this.pps); this.redraw(); return;
    }
    const dr = this.drag; if (!dr) return;
    const { x, y } = this._local(e); const t = Math.max(0, this.timeAt(x));
    if (dr.kind === 'sel') {
      if (!dr.moved && Math.abs(x - dr.startX) < 6) return;
      dr.moved = true; this.state.selection = [Math.min(dr.t0, t), Math.max(dr.t0, t)]; this.onSelect?.(this.state.selection, true); this.redrawOverlay();
      this._edgeScroll(x);
    } else if (dr.kind === 'edge') {
      const s = this.state.selection.slice(); s[dr.which] = t; if (s[0] > s[1]) { s.reverse(); dr.which = 1 - dr.which; }
      this.state.selection = s; this.onSelect?.(s, true); this.redrawOverlay(); this._edgeScroll(x);
    } else if (dr.kind === 'clip') {
      if (!dr.moved && Math.abs(x - dr.startX) < 6 && Math.abs(y - dr.startY) < 10) return;
      dr.moved = true;
      let ns = Math.max(0, dr.origStart + (x - dr.startX) / this.pps);
      const sn = this._snap(ns, dr.clip.id); const snEnd = this._snap(ns + dr.clip.duration, dr.clip.id) - dr.clip.duration;
      ns = Math.abs(sn - ns) <= Math.abs(snEnd - ns) ? sn : snEnd;
      dr.newStart = ns; dr.newLane = Math.max(0, Math.min(this.tracksShown().length - 1, Math.floor(y / this.laneH)));
      // live preview by temporarily moving
      dr.clip.start = ns; this.drawBase(); this.drawOverlay();
      const c = this.over.getContext('2d'); c.strokeStyle = css('--accent'); c.lineWidth = 3; c.strokeRect(this.xAt(ns), dr.newLane * this.laneH + 2, dr.clip.duration * this.pps, this.laneH - 4);
    } else if (dr.kind === 'env') {
      if (!dr.moved && Math.hypot(x - dr.startX, y - dr.startY) < 6) return;
      dr.moved = true;
      if (dr.idx < 0) { dr.idx = this.onEnvelopeEdit?.(dr.track.id, 'add', { t: dr.t, v: dr.vAt(dr.startY) }, true); }
      const yy = y - 0; this.onEnvelopeEdit?.(dr.track.id, 'move', { idx: dr.idx, t, v: dr.vAt(yy) }, true);
    }
  }
  _edgeScroll(x) { const W = this.wrap.clientWidth; if (x > W - 20) { this.scroll += 20 / this.pps; this.redraw(); } else if (x < 20 && this.scroll > 0) { this.scroll = Math.max(0, this.scroll - 20 / this.pps); this.redraw(); } }
  _up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size === 0) this.pinch = null; return; }
    const dr = this.drag; this.drag = null; if (!dr) return;
    const { x } = this._local(e); const t = Math.max(0, this.timeAt(x));
    if (dr.kind === 'sel') {
      if (!dr.moved) { this.state.selection = null; this.state.selectedClipId = this.mode === 'multi' && dr.clip ? dr.clip.id : null; this.onCursor?.(t); this.onSelect?.(null); this.redraw(); }
      else this.onSelect?.(this.state.selection, false);
    } else if (dr.kind === 'edge') this.onSelect?.(this.state.selection, false);
    else if (dr.kind === 'clip') {
      dr.clip.start = dr.origStart;
      if (dr.moved) this.onClipMove?.(dr.clip.id, dr.newStart, this.tracksShown()[dr.newLane].id); else this.redraw();
    } else if (dr.kind === 'env') {
      if (!dr.moved && dr.idx < 0) this.onEnvelopeEdit?.(dr.track.id, 'add', { t: dr.t, v: dr.vAt(dr.startY) });
      else if (dr.moved) this.onEnvelopeEdit?.(dr.track.id, 'commit');
    }
  }
}
function roundRect(c, x, y, w, hh, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, Math.max(1, w), hh, Math.min(r, w / 2)); else c.rect(x, y, w, hh); }
