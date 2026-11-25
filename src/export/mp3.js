import { Mp3Encoder } from '@breezystack/lamejs';
export function encodeMP3(pcm, kbps = 192, onProgress) {
  const nch = Math.min(2, pcm.channels.length), enc = new Mp3Encoder(nch, pcm.sampleRate, kbps);
  const toI16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return o; };
  const L = toI16(pcm.channels[0]), R = nch > 1 ? toI16(pcm.channels[1]) : null;
  const parts = []; const B = 1152 * 20;
  for (let i = 0; i < L.length; i += B) {
    const buf = nch > 1 ? enc.encodeBuffer(L.subarray(i, i + B), R.subarray(i, i + B)) : enc.encodeBuffer(L.subarray(i, i + B));
    if (buf.length) parts.push(new Uint8Array(buf));
    if (onProgress && (i / B) % 20 === 0) onProgress(i / L.length);
  }
  const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
  const total = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
