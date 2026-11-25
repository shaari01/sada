import { stft } from './fft.js';

/** Onset strength envelope via spectral flux. returns {env, rate} */
export function onsetEnvelope(mono, sampleRate) {
  const size = 1024, hop = Math.round(sampleRate / 100); // ~100 frames/s
  const half = size / 2;
  let prev = new Float32Array(half);
  const env = [];
  const maxBin = Math.min(half, Math.round((8000 / sampleRate) * size));
  stft(mono, size, hop, (f, re, im) => {
    let flux = 0; const cur = new Float32Array(half);
    for (let k = 1; k < maxBin; k++) { const m = Math.log1p(100 * Math.hypot(re[k], im[k])); cur[k] = m; const d = m - prev[k]; if (d > 0) flux += d; }
    prev = cur; env.push(flux);
  });
  const e = Float32Array.from(env);
  // remove local mean (simple high-pass), half-wave rectify
  const w = 15, out = new Float32Array(e.length);
  for (let i = 0; i < e.length; i++) { let s = 0, c = 0; for (let j = Math.max(0, i - w); j <= Math.min(e.length - 1, i + w); j++) { s += e[j]; c++; } out[i] = Math.max(0, e[i] - s / c); }
  return { env: out, rate: sampleRate / hop };
}

/** Estimate tempo (BPM 60–200) and first-beat offset (seconds). */
export function detectBPM(mono, sampleRate) {
  const { env, rate } = onsetEnvelope(mono, sampleRate);
  if (env.length < rate * 2) return null;
  const minLag = Math.floor((rate * 60) / 200), maxLag = Math.ceil((rate * 60) / 60);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) { let s = 0; for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag]; ac[lag] = s / (env.length - lag); }
  let best = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * rate) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2)); // mild preference around 120
    // reinforce with harmonics (2x lag)
    const sc = (ac[lag] + 0.5 * (ac[lag * 2] || 0)) * prior;
    if (sc > bestScore) { bestScore = sc; best = lag; }
  }
  // parabolic refine
  const y0 = ac[best - 1] || 0, y1 = ac[best], y2 = ac[best + 1] || 0;
  const den = y0 - 2 * y1 + y2; const shift = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
  const lag = best + shift;
  let bpm = (60 * rate) / lag;
  bpm = Math.round(bpm * 10) / 10;
  // phase: best offset within one period
  const period = lag; let bestOff = 0, bestSum = -1;
  for (let off = 0; off < period; off++) { let s = 0; for (let p = off; p < env.length; p += period) s += env[Math.round(p)] || 0; if (s > bestSum) { bestSum = s; bestOff = off; } }
  // onset envelope frame t corresponds to window start; centre it
  const offset = (bestOff + 1024 / 2 / (sampleRate / rate)) / rate;
  return { bpm, offset: offset % (60 / bpm), confidence: bestScore };
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export const NOTE_NAMES_AR = ['دو', 'دو#', 'ري', 'ري#', 'مي', 'فا', 'فا#', 'صول', 'صول#', 'لا', 'لا#', 'سي'];

export function chroma(mono, sampleRate, maxSeconds = 90) {
  const x = mono.length > maxSeconds * sampleRate ? mono.subarray(0, maxSeconds * sampleRate) : mono;
  const size = 8192, hop = 4096, c = new Float64Array(12);
  stft(x, size, hop, (f, re, im) => {
    for (let k = 1; k < size / 2; k++) {
      const fr = (k * sampleRate) / size; if (fr < 55 || fr > 2000) continue;
      const midi = 69 + 12 * Math.log2(fr / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      c[pc] += Math.hypot(re[k], im[k]);
    }
  });
  return c;
}
function corr(a, b) { const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb + 1e-12); }

/** returns {tonic 0-11, mode 'major'|'minor', name} */
export function detectKey(mono, sampleRate) {
  const c = chroma(mono, sampleRate);
  let best = null;
  for (let t = 0; t < 12; t++) for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
    const rot = prof.map((_, i) => prof[(i - t + 12) % 12]);
    const r = corr(c, rot);
    if (!best || r > best.r) best = { tonic: t, mode, r };
  }
  best.name = `${NOTE_NAMES_AR[best.tonic]} ${best.mode === 'major' ? 'كبير' : 'صغير'}`;
  return best;
}
/** semitone shift (−6..+5) to move key a → key b (compares relative majors) */
export function keyShift(a, b) {
  const rel = (k) => (k.mode === 'minor' ? (k.tonic + 3) % 12 : k.tonic);
  let d = (rel(b) - rel(a) + 12) % 12; if (d > 5) d -= 12; return d;
}
