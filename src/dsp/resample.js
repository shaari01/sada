// cubic (Catmull-Rom) resampling helpers
export function readCubic(x, pos) {
  const i = Math.floor(pos), f = pos - i;
  const n = x.length;
  const y0 = x[Math.max(0, i - 1)] ?? 0, y1 = x[Math.min(n - 1, Math.max(0, i))] ?? 0, y2 = x[Math.min(n - 1, i + 1)] ?? 0, y3 = x[Math.min(n - 1, i + 2)] ?? 0;
  const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c = -0.5 * y0 + 0.5 * y2;
  return ((a * f + b) * f + c) * f + y1;
}
/** resample by ratio: output length = len/ratio; ratio>1 → higher pitch & shorter. Simple anti-alias lowpass when ratio>1. */
export function resampleRatio(x, ratio) {
  let src = x;
  if (ratio > 1.05) src = lowpass(x, 0.45 / ratio);
  const n = Math.floor(x.length / ratio);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = readCubic(src, i * ratio);
  return y;
}
// windowed-sinc FIR lowpass, cutoff as fraction of sample rate
export function lowpass(x, fc, taps = 31) {
  const h = new Float32Array(taps), m = (taps - 1) / 2; let sum = 0;
  for (let i = 0; i < taps; i++) { const k = i - m; const s = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k); const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)); h[i] = s * w; sum += h[i]; }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { let acc = 0; for (let j = 0; j < taps; j++) { const k = i + j - m; if (k >= 0 && k < x.length) acc += x[k] * h[j]; } y[i] = acc; }
  return y;
}
