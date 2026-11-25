// PCM: { sampleRate, channels: Float32Array[] } — plain, transferable, testable in Node.
export function createPCM(sampleRate, numChannels, length) {
  const channels = [];
  for (let c = 0; c < numChannels; c++) channels.push(new Float32Array(Math.max(0, Math.round(length))));
  return { sampleRate, channels };
}
export const pcmLength = (p) => (p.channels[0] ? p.channels[0].length : 0);
export const pcmDuration = (p) => pcmLength(p) / p.sampleRate;

export function fromAudioBuffer(ab) {
  const channels = [];
  for (let c = 0; c < ab.numberOfChannels; c++) channels.push(new Float32Array(ab.getChannelData(c)));
  return { sampleRate: ab.sampleRate, channels };
}
export function toAudioBuffer(ctx, p) {
  const len = Math.max(1, pcmLength(p));
  const ab = ctx.createBuffer(p.channels.length, len, p.sampleRate);
  p.channels.forEach((ch, i) => { if (ch.length) ab.copyToChannel(ch, i); });
  return ab;
}
export function slicePCM(p, startSample, endSample) {
  const s = Math.max(0, Math.floor(startSample));
  const e = Math.min(pcmLength(p), Math.floor(endSample));
  return { sampleRate: p.sampleRate, channels: p.channels.map((ch) => ch.slice(s, Math.max(s, e))) };
}
export function mixdownMono(p) {
  const n = pcmLength(p);
  const out = new Float32Array(n);
  const k = 1 / p.channels.length;
  for (const ch of p.channels) for (let i = 0; i < n; i++) out[i] += ch[i] * k;
  return out;
}
export function ensureChannels(p, n) {
  if (p.channels.length === n) return p;
  if (p.channels.length === 1 && n === 2) return { sampleRate: p.sampleRate, channels: [p.channels[0], new Float32Array(p.channels[0])] };
  if (p.channels.length === 2 && n === 1) return { sampleRate: p.sampleRate, channels: [mixdownMono(p)] };
  return p;
}
export function peakOf(p) {
  let m = 0;
  for (const ch of p.channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > m) m = a; }
  return m;
}
export function reversePCM(p) {
  return { sampleRate: p.sampleRate, channels: p.channels.map((ch) => ch.slice().reverse()) };
}
export function gainPCM(p, g) {
  return { sampleRate: p.sampleRate, channels: p.channels.map((ch) => ch.map((v) => v * g)) };
}
export function concatPCM(a, b) {
  const n = Math.max(a.channels.length, b.channels.length);
  const A = ensureChannels(a, n), B = ensureChannels(b, n);
  return { sampleRate: a.sampleRate, channels: A.channels.map((ch, i) => { const o = new Float32Array(ch.length + B.channels[i].length); o.set(ch); o.set(B.channels[i], ch.length); return o; }) };
}
