// Gain envelope: sorted points {t, v, curve}. `curve` shapes the segment that ENDS at the point.
// curves: 'linear' | 'smooth' (S-curve) | 'fast' (fast then slow) | 'slow' (slow then fast)
export const CURVES = ['linear', 'smooth', 'fast', 'slow'];
export function shape(curve, x) {
  x = Math.min(1, Math.max(0, x));
  switch (curve) {
    case 'smooth': return 0.5 - 0.5 * Math.cos(Math.PI * x);
    case 'fast': return 1 - (1 - x) * (1 - x);
    case 'slow': return x * x;
    default: return x;
  }
}
export function sortEnv(env) { return [...env].sort((a, b) => a.t - b.t); }
export function envValueAt(env, t, def = 1) {
  if (!env || env.length === 0) return def;
  if (t <= env[0].t) return env[0].v;
  const last = env[env.length - 1];
  if (t >= last.t) return last.v;
  let lo = 0, hi = env.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (env[m].t <= t) lo = m; else hi = m; }
  const a = env[lo], b = env[hi];
  const x = (t - a.t) / Math.max(1e-9, b.t - a.t);
  return a.v + (b.v - a.v) * shape(b.curve, x);
}
export function sampleEnv(env, t0, t1, rate = 200, def = 1) {
  const n = Math.max(2, Math.ceil((t1 - t0) * rate) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = envValueAt(env, t0 + ((t1 - t0) * i) / (n - 1), def);
  return out;
}
// "Ramp to level": from v0 to v1 over [a,b]; keeps v1 after b until the next existing point.
export function applyRamp(env, a, b, v0, v1, curve = 'linear', def = 1) {
  const before = envValueAt(env, a - 1e-4, def);
  const after = envValueAt(env, b + 1e-4, def);
  const kept = env.filter((p) => p.t < a - 1e-6 || p.t > b + 1e-6);
  const pts = [{ t: a, v: v0, curve: 'linear' }, { t: b, v: v1, curve }];
  if (a > 0.02) pts.unshift({ t: a - 0.01, v: before, curve: 'linear' });
  void after;
  return sortEnv([...kept, ...pts]);
}
export function shiftEnv(env, from, delta, removeFrom = null, removeTo = null) {
  return env
    .filter((p) => removeFrom == null || p.t < removeFrom || p.t > removeTo)
    .map((p) => (p.t >= from ? { ...p, t: Math.max(0, p.t + delta) } : p));
}
