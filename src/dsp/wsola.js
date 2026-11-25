// WSOLA time-scale modification (own implementation, no external license).
// speed: number or function(u in [0,1] of input) → speed factor (2 = twice as fast / half as long).
import { resampleRatio } from './resample.js';

function decimate(x, D) {
  const n = Math.floor(x.length / D), y = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < D; k++) s += x[i * D + k]; y[i] = s / D; }
  return y;
}

export function timeStretch(channels, sampleRate, speed, { onProgress } = {}) {
  const speedFn = typeof speed === 'function' ? speed : () => speed;
  const len = channels[0].length;
  let N = Math.round(sampleRate * 0.05); N -= N % 16;
  const Hs = N / 2;
  const tol = Math.round(sampleRate * 0.012);
  if (len < N * 2) {
    // too short: plain resample fallback
    const s = speedFn(0.5);
    return channels.map((c) => resampleRatio(c, s));
  }
  const mono = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) mono[i] += ch[i] / channels.length;
  const D = 8;
  const md = decimate(mono, D);
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  // estimate output size
  let est = 0; { let p = 0; while (p < len) { const s = Math.max(0.1, speedFn(p / len)); p += Hs * s; est += Hs; } }
  const outLen = est + N * 2;
  const outs = channels.map(() => new Float32Array(outLen));
  const norm = new Float32Array(outLen);

  const ola = (actual, outPos) => {
    for (let c = 0; c < channels.length; c++) {
      const x = channels[c], o = outs[c];
      for (let i = 0; i < N; i++) { const k = actual + i; if (k < len) o[outPos + i] += x[k] * w[i]; }
    }
    for (let i = 0; i < N; i++) norm[outPos + i] += w[i];
  };

  let inPos = 0, prevActual = 0, outPos = 0;
  ola(0, 0);
  const tolD = Math.round(tol / D), LD = Math.round(Hs / D);
  let frames = 0;
  while (true) {
    const s = Math.max(0.1, speedFn(Math.min(1, inPos / len)));
    inPos += Hs * s;
    const natural = prevActual + Hs;
    const target = Math.round(inPos);
    if (target + N + tol >= len || natural + Hs >= len) break;
    // coarse search on decimated mono
    const nd = Math.floor(natural / D), td = Math.floor(target / D);
    let best = 0, bestScore = -Infinity;
    for (let d = -tolD; d <= tolD; d++) {
      const st = td + d; if (st < 0 || st + LD >= md.length) continue;
      let sc = 0, en = 1e-9;
      for (let i = 0; i < LD; i++) { const v = md[st + i]; sc += md[nd + i] * v; en += v * v; }
      sc /= Math.sqrt(en);
      if (sc > bestScore) { bestScore = sc; best = d; }
    }
    // fine search ±D at full rate
    let actual = (td + best) * D, fBest = actual, fScore = -Infinity;
    for (let d = -D; d <= D; d++) {
      const st = actual + d; if (st < 0 || st + Hs >= len) continue;
      let sc = 0, en = 1e-9;
      for (let i = 0; i < Hs; i += 2) { const v = mono[st + i]; sc += mono[natural + i] * v; en += v * v; }
      sc /= Math.sqrt(en);
      if (sc > fScore) { fScore = sc; fBest = st; }
    }
    actual = Math.max(0, fBest);
    outPos += Hs;
    ola(actual, outPos);
    prevActual = actual;
    if (onProgress && (++frames & 511) === 0) onProgress(inPos / len);
  }
  const finalLen = outPos + N;
  return outs.map((o) => {
    const r = o.subarray(0, finalLen).slice();
    for (let i = 0; i < finalLen; i++) r[i] = norm[i] > 1e-3 ? r[i] / norm[i] : 0;
    return r;
  });
}

/** pitch shift by semitones keeping duration. */
export function pitchShift(channels, sampleRate, semitones, opts) {
  if (!semitones) return channels.map((c) => c.slice());
  const r = Math.pow(2, semitones / 12);
  const stretched = timeStretch(channels, sampleRate, 1 / r, opts);
  const len = channels[0].length;
  return stretched.map((c) => { const y = resampleRatio(c, r); const o = new Float32Array(len); o.set(y.subarray(0, len)); return o; });
}

/** speed curve from points [{u, s}] (u 0..1) with linear interpolation */
export function speedCurve(points) {
  const pts = [...points].sort((a, b) => a.u - b.u);
  return (u) => {
    if (u <= pts[0].u) return pts[0].s;
    for (let i = 1; i < pts.length; i++) if (u <= pts[i].u) { const a = pts[i - 1], b = pts[i]; return a.s + ((b.s - a.s) * (u - a.u)) / Math.max(1e-9, b.u - a.u); }
    return pts[pts.length - 1].s;
  };
}

/** Combined: variable speed + pitch shift in one pass. */
export function speedAndPitch(channels, sampleRate, speed, semitones = 0, opts) {
  const r = Math.pow(2, (semitones || 0) / 12);
  const sf = typeof speed === 'function' ? speed : () => speed;
  const st = timeStretch(channels, sampleRate, (u) => sf(u) / r, opts);
  if (r === 1) return st;
  return st.map((c) => resampleRatio(c, r));
}
