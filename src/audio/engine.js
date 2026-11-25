import { toAudioBuffer, fromAudioBuffer } from '../core/pcm.js';
import { audibleTracks, clipEnd, projectDuration } from '../core/project.js';
import { sampleEnv } from '../core/envelope.js';
import { fadeGain } from '../core/mix.js';

let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
const bufCache = new WeakMap();
export function bufferFor(c, src) {
  // AudioBuffers are context-independent in modern Chrome, but offline contexts are short-lived: only cache for the realtime one
  if (c !== ctx) return toAudioBuffer(c, src);
  let m = bufCache.get(c); if (!m) bufCache.set(c, (m = new Map()));
  let b = m.get(src.id);
  if (!b) { b = toAudioBuffer(c, src); m.set(src.id, b); }
  return b;
}

function curve(param, values, when, dur) {
  if (dur <= 0.002 || values.length < 2) { param.setValueAtTime(values[0] ?? 1, when); return; }
  param.setValueAtTime(values[0], when);
  param.setValueCurveAtTime(values, when + 0.0005, dur - 0.001);
}

/** Build the playback/mix graph for [t0, t1] starting at context time `when`. */
export function buildGraph(c, project, getSource, t0, t1, dest, when, { trackFilter = null, isOffline = false } = {}) {
  const nodes = [];
  const dur = t1 - t0;
  for (const tr of trackFilter ? project.tracks.filter(trackFilter) : audibleTracks(project)) {
    const tg = c.createGain(); nodes.push(tg);
    const env = sampleEnv(tr.envelope, t0, t1, isOffline ? 400 : 100);
    for (let i = 0; i < env.length; i++) env[i] *= tr.volume;
    curve(tg.gain, env, when, dur);
    let out = tg;
    if (c.createStereoPanner && tr.pan) { const p = c.createStereoPanner(); p.pan.value = tr.pan; tg.connect(p); out = p; nodes.push(p); }
    out.connect(dest);
    for (const cl of tr.clips) {
      if (clipEnd(cl) <= t0 || cl.start >= t1) continue;
      const src = getSource(cl.sourceId); if (!src) continue;
      const s = c.createBufferSource(); s.buffer = bufferFor(c, src);
      const g = c.createGain();
      const from = Math.max(t0, cl.start), to = Math.min(t1, clipEnd(cl));
      const needsCurve = cl.fadeIn > 0 || cl.fadeOut > 0;
      const startAt = when + (from - t0);
      if (needsCurve) {
        const n = Math.max(2, Math.ceil((to - from) * 200));
        const vals = new Float32Array(n); for (let i = 0; i < n; i++) vals[i] = fadeGain(cl, from - cl.start + ((to - from) * i) / (n - 1));
        curve(g.gain, vals, startAt, to - from);
      } else g.gain.value = cl.gain ?? 1;
      s.connect(g); g.connect(tg);
      s.start(startAt, cl.offset + (from - cl.start), to - from);
      nodes.push(s, g);
    }
  }
  return nodes;
}

export class Player {
  constructor(getProject, getSource) { this.getProject = getProject; this.getSource = getSource; this.playing = false; this.nodes = []; this.listeners = new Set(); }
  on(fn) { this.listeners.add(fn); }
  emit() { for (const f of this.listeners) f(this); }
  play(from = 0, to = null, loop = false) {
    this.stop(true);
    const c = audioCtx(); const p = this.getProject();
    const end = to ?? Math.max(projectDuration(p), from + 0.1);
    if (end - from < 0.02) return;
    this.master = c.createGain(); this.master.connect(c.destination);
    const when = c.currentTime + 0.05;
    this.nodes = buildGraph(c, p, this.getSource, from, end, this.master, when);
    if (this.extra) this.extra(c, this.master, when, from, end);
    Object.assign(this, { playing: true, startCtx: when, from, to: end, loop, range: to != null });
    this._raf();
    this.emit();
  }
  playPCM(pcm, onEnd) {
    this.stop(true); const c = audioCtx();
    const s = c.createBufferSource(); s.buffer = toAudioBuffer(c, pcm); s.connect(c.destination); s.start();
    this.nodes = [s]; this.playing = true; this.preview = true; this.startCtx = c.currentTime; this.from = 0; this.to = pcm.channels[0].length / pcm.sampleRate;
    s.onended = () => { if (this.nodes[0] === s) { this.stop(); onEnd?.(); } };
    this.emit();
  }
  position() { if (!this.playing) return null; return this.from + Math.max(0, audioCtx().currentTime - this.startCtx); }
  _raf() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.playing) return;
      const pos = this.position();
      if (pos >= this.to - 0.005) { if (this.loop) { this.play(this.from, this.to, true); return; } this.stop(); return; }
      this.emit();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop(silent = false) {
    cancelAnimationFrame(this.raf);
    for (const n of this.nodes) { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} }
    try { this.master?.disconnect(); } catch {}
    this.nodes = []; const was = this.playing; this.playing = false; this.preview = false;
    if (!silent && was) this.emit();
    this.onStop?.();
  }
}

/** Offline mixdown of [t0,t1] (whole project by default). */
export async function renderProject(project, getSource, { t0 = 0, t1 = null, trackFilter = null } = {}) {
  const end = t1 ?? projectDuration(project);
  const sr = project.sampleRate;
  const len = Math.max(1, Math.ceil((end - t0) * sr));
  const oc = new OfflineAudioContext(2, len, sr);
  buildGraph(oc, project, getSource, t0, end, oc.destination, 0, { trackFilter, isOffline: true });
  const ab = await oc.startRendering();
  return fromAudioBuffer(ab);
}

/** Process a PCM through a Web Audio node chain offline. chain(ctx, inputNode) → outputNode */
export async function processWithChain(pcm, chain, { tail = 0 } = {}) {
  const len = pcm.channels[0].length + Math.round(tail * pcm.sampleRate);
  const nch = Math.max(2, pcm.channels.length);
  const oc = new OfflineAudioContext(nch, Math.max(1, len), pcm.sampleRate);
  const s = oc.createBufferSource(); s.buffer = toAudioBuffer(oc, pcm);
  const out = chain(oc, s);
  out.connect(oc.destination); s.start();
  const ab = await oc.startRendering();
  const r = fromAudioBuffer(ab);
  if (pcm.channels.length === 1) { const m = new Float32Array(r.channels[0].length); for (let i = 0; i < m.length; i++) m[i] = (r.channels[0][i] + r.channels[1][i]) / 2; return { sampleRate: r.sampleRate, channels: [m] }; }
  return r;
}

export async function decodeFile(file) {
  const c = audioCtx();
  const ab = await c.decodeAudioData(await file.arrayBuffer());
  return fromAudioBuffer(ab);
}
