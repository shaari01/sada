export function sine(freq, seconds, sr = 44100, amp = 0.5) { const n = Math.round(seconds * sr); const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr); return x; }
export function zeroCrossFreq(x, sr) { let z = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) z++; return (z * sr) / x.length; }
export function clickTrack(bpm, seconds, sr = 44100, offset = 0.1) {
  const x = new Float32Array(Math.round(seconds * sr)); const period = 60 / bpm;
  for (let t = offset; t < seconds; t += period) { const s = Math.round(t * sr); for (let i = 0; i < 2000 && s + i < x.length; i++) x[s + i] += Math.exp(-i / 300) * (Math.random() * 2 - 1) * 0.8; }
  return x;
}
