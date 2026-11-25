// Automatic ducking: find speech/voice activity and build an envelope that lowers the music under it.
export function voiceActivity(mono, sr, { win = 0.05, hold = 0.35, minGap = 0.6, sens = 0.15 } = {}) {
  const W = Math.max(1, Math.round(win * sr)), n = Math.floor(mono.length / W), rms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < W; k++) { const v = mono[i * W + k]; s += v * v; } rms[i] = Math.sqrt(s / W); }
  const sorted = Float32Array.from(rms).sort(); const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const thr = Math.max(0.005, p95 * sens);
  const segs = []; let cur = null;
  for (let i = 0; i < n; i++) {
    const t = i * win;
    if (rms[i] > thr) { if (!cur) cur = [t, t + win]; else cur[1] = t + win; }
    else if (cur && t - cur[1] > hold) { segs.push(cur); cur = null; }
  }
  if (cur) segs.push(cur);
  const merged = [];
  for (const s of segs) { const last = merged[merged.length - 1]; if (last && s[0] - last[1] < minGap) last[1] = s[1]; else merged.push([...s]); }
  return merged.filter((s) => s[1] - s[0] > 0.15);
}
export function duckEnvelope(segs, { level = 0.3, attack = 0.3, release = 0.6, offset = 0 } = {}) {
  const env = [{ t: 0, v: 1, curve: 'linear' }];
  for (const [s0, e0] of segs) {
    const s = s0 + offset, e = e0 + offset;
    env.push({ t: Math.max(0, s - attack), v: 1, curve: 'linear' }, { t: Math.max(0.001, s), v: level, curve: 'smooth' }, { t: e, v: level, curve: 'linear' }, { t: e + release, v: 1, curve: 'smooth' });
  }
  return env.sort((a, b) => a.t - b.t).filter((p, i, a) => i === 0 || p.t > a[i - 1].t + 1e-4);
}
