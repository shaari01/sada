import { fft, hann } from './fft.js';

// ---------- biquad (RBJ) ----------
export function biquadNotch(x, sr, f0, Q = 30) {
  const w0 = (2 * Math.PI * f0) / sr, al = Math.sin(w0) / (2 * Q), cs = Math.cos(w0);
  const a0 = 1 + al, b0 = 1 / a0, b1 = (-2 * cs) / a0, b2 = 1 / a0, a1 = (-2 * cs) / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
function goertzel(x, sr, f) { const k = (2 * Math.PI * f) / sr, c = 2 * Math.cos(k); let s1 = 0, s2 = 0; const n = Math.min(x.length, sr * 20); for (let i = 0; i < n; i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; } return s1 * s1 + s2 * s2 - c * s1 * s2; }
export function detectHum(x, sr) { let e50 = 0, e60 = 0; for (let h = 1; h <= 3; h++) { e50 += goertzel(x, sr, 50 * h); e60 += goertzel(x, sr, 60 * h); } return e60 >= e50 ? 60 : 50; }
export function humRemove(x, sr, freq = 'auto') {
  const f = freq === 'auto' ? detectHum(x, sr) : freq;
  let y = x; for (let h = 1; h <= 6; h++) if (f * h < sr / 2) y = biquadNotch(y, sr, f * h, 25 + h * 5);
  return y;
}

// ---------- spectral noise reduction ----------
export function denoise(x, sr, { strength = 1, noiseStart = null, noiseEnd = null } = {}) {
  const N = 2048, H = 512, half = N / 2 + 1, w = hann(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const nFrames = Math.max(0, Math.floor((x.length - N) / H) + 1);
  // 1) choose noise frames: given region, or the 10% quietest frames
  let noiseFrames = [];
  if (noiseStart != null && noiseEnd != null && noiseEnd > noiseStart) {
    for (let f = Math.floor((noiseStart * sr) / H); f * H + N <= Math.min(x.length, noiseEnd * sr); f++) noiseFrames.push(f);
  }
  if (noiseFrames.length < 3) {
    const en = []; for (let f = 0; f < nFrames; f++) { let s = 0; for (let i = 0; i < N; i += 4) s += x[f * H + i] ** 2; en.push([s, f]); }
    en.sort((a, b) => a[0] - b[0]); noiseFrames = en.slice(0, Math.max(3, Math.floor(nFrames * 0.1))).map((e) => e[1]);
  }
  const noise = new Float64Array(half);
  for (const f of noiseFrames) { for (let i = 0; i < N; i++) { re[i] = x[f * H + i] * w[i]; im[i] = 0; } fft(re, im); for (let k = 0; k < half; k++) noise[k] += Math.hypot(re[k], im[k]) / noiseFrames.length; }
  // 2) spectral gating with temporal smoothing of the gain
  const y = new Float32Array(x.length), wsum = new Float32Array(x.length);
  const prevG = new Float64Array(half).fill(1);
  const floor = Math.max(0.05, 0.3 - 0.2 * strength), over = 1 + strength;
  for (let f = 0; f < nFrames; f++) {
    const pos = f * H;
    for (let i = 0; i < N; i++) { re[i] = x[pos + i] * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < half; k++) {
      const m = Math.hypot(re[k], im[k]) + 1e-12;
      let g = Math.max(floor, 1 - (over * noise[k]) / m);
      g = g > prevG[k] ? 0.5 * g + 0.5 * prevG[k] : 0.7 * g + 0.3 * prevG[k];
      prevG[k] = g;
      re[k] *= g; im[k] *= g; if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) { y[pos + i] += re[i] * w[i]; wsum[pos + i] += w[i] * w[i]; }
  }
  for (let i = 0; i < y.length; i++) y[i] = wsum[i] > 1e-3 ? y[i] / wsum[i] : x[i];
  return y;
}

// ---------- approximate stem separation (classical, no AI) ----------
function median(arr, n) { // insertion sort on small arrays
  for (let i = 1; i < n; i++) { const v = arr[i]; let j = i - 1; while (j >= 0 && arr[j] > v) { arr[j + 1] = arr[j]; j--; } arr[j + 1] = v; }
  return arr[n >> 1];
}
/** Splits stereo audio into {vocals, drums, bass, other} using HPSS + stereo-centre + frequency masks. */
export function hpss(channels, sr, onProgress) {
  const L = channels[0], R = channels[1] || channels[0];
  const N = 2048, H = 512, half = N / 2 + 1, w = hann(N), K = 8; // median half-widths
  const len = L.length;
  const nFrames = Math.max(1, Math.floor((len - N) / H) + 1);
  const stems = ['vocals', 'drums', 'bass', 'other'];
  const out = {}; for (const s of stems) out[s] = [new Float32Array(len), new Float32Array(len)];
  const wsum = new Float32Array(len);
  const bassBin = Math.round((160 * N) / sr), vocHi = Math.round((9000 * N) / sr);
  const BLOCK = 128;
  const tmp = new Float64Array(2 * K + 1);
  for (let b0 = 0; b0 < nFrames; b0 += BLOCK) {
    const f0 = Math.max(0, b0 - K), f1 = Math.min(nFrames, b0 + BLOCK + K);
    const nf = f1 - f0;
    const LR = [], LI = [], RR = [], RI = [], M = [];
    for (let f = f0; f < f1; f++) {
      const lr = new Float64Array(N), li = new Float64Array(N), rr = new Float64Array(N), ri = new Float64Array(N);
      for (let i = 0; i < N; i++) { lr[i] = L[f * H + i] * w[i]; rr[i] = R[f * H + i] * w[i]; }
      fft(lr, li); fft(rr, ri);
      const m = new Float32Array(half); for (let k = 0; k < half; k++) m[k] = Math.hypot(lr[k] + rr[k], li[k] + ri[k]) / 2;
      LR.push(lr); LI.push(li); RR.push(rr); RI.push(ri); M.push(m);
    }
    for (let f = b0; f < Math.min(nFrames, b0 + BLOCK); f++) {
      const j = f - f0, pos = f * H;
      const cur = [[LR[j], LI[j]], [RR[j], RI[j]]];
      const masks = { vocals: new Float32Array(half), drums: new Float32Array(half), bass: new Float32Array(half) };
      for (let k = 0; k < half; k++) {
        let n = 0; for (let d = -K; d <= K; d++) { const jj = j + d; if (jj >= 0 && jj < nf) tmp[n++] = M[jj][k]; }
        const hm = median(tmp, n);
        n = 0; for (let d = -K; d <= K; d++) { const kk = k + d; if (kk >= 0 && kk < half) tmp[n++] = M[j][kk]; }
        const pm = median(tmp, n);
        const h2 = hm * hm, p2 = pm * pm, den = h2 + p2 + 1e-12;
        const mH = h2 / den, mP = p2 / den;
        // centredness: 1 when L≈R
        const lm = Math.hypot(LR[j][k], LI[j][k]), rm = Math.hypot(RR[j][k], RI[j][k]);
        const dot = LR[j][k] * RR[j][k] + LI[j][k] * RI[j][k];
        const centre = Math.max(0, (2 * dot) / (lm * lm + rm * rm + 1e-12));
        if (k <= bassBin) { masks.bass[k] = mH; masks.drums[k] = mP; }
        else { masks.drums[k] = mP; if (k < vocHi) masks.vocals[k] = mH * Math.pow(centre, 4); }
      }
      for (const s of ['vocals', 'drums', 'bass']) for (let c = 0; c < 2; c++) {
        const re = new Float64Array(N), im = new Float64Array(N), [sr_, si_] = cur[c], mk = masks[s];
        for (let k = 0; k < half; k++) { re[k] = sr_[k] * mk[k]; im[k] = si_[k] * mk[k]; if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; } }
        fft(re, im, true);
        const o = out[s][c]; for (let i = 0; i < N; i++) o[pos + i] += re[i] * w[i];
      }
      for (let i = 0; i < N; i++) wsum[pos + i] += w[i] * w[i];
    }
    onProgress?.(Math.min(1, (b0 + BLOCK) / nFrames));
  }
  for (const s of ['vocals', 'drums', 'bass']) for (let c = 0; c < 2; c++) { const o = out[s][c]; for (let i = 0; i < len; i++) o[i] = wsum[i] > 1e-3 ? o[i] / wsum[i] : 0; }
  // other = original − (vocals + drums + bass) so the stems always sum back to the song
  for (let c = 0; c < 2; c++) { const src = c ? R : L, o = out.other[c]; for (let i = 0; i < len; i++) o[i] = src[i] - out.vocals[c][i] - out.drums[c][i] - out.bass[c][i]; }
  return out;
}
