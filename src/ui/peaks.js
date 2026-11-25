const BIN = 256;
const cache = new Map();
export function peaksFor(src) {
  let p = cache.get(src.id); if (p) return p;
  const len = src.channels[0].length, n = Math.ceil(len / BIN);
  const mn = new Float32Array(n), mx = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let lo = 0, hi = 0; const s = b * BIN, e = Math.min(len, s + BIN);
    for (const ch of src.channels) for (let i = s; i < e; i++) { const v = ch[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
    mn[b] = lo; mx[b] = hi;
  }
  p = { mn, mx }; cache.set(src.id, p); return p;
}
/** min/max over sample range [s0,s1) */
export function minMax(src, s0, s1) {
  const len = src.channels[0].length; s0 = Math.max(0, Math.floor(s0)); s1 = Math.min(len, Math.ceil(s1));
  if (s1 <= s0) return null;
  let lo = 0, hi = 0;
  if (s1 - s0 >= BIN * 2) {
    const p = peaksFor(src); const b0 = Math.floor(s0 / BIN), b1 = Math.ceil(s1 / BIN);
    for (let b = b0; b < b1; b++) { if (p.mn[b] < lo) lo = p.mn[b]; if (p.mx[b] > hi) hi = p.mx[b]; }
  } else {
    for (const ch of src.channels) for (let i = s0; i < s1; i++) { const v = ch[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  return [lo, hi];
}
