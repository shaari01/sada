export function encodeWAV(pcm, bits = 16) {
  const nch = pcm.channels.length, len = pcm.channels[0]?.length || 0, sr = pcm.sampleRate;
  const bps = bits / 8, dataSize = len * nch * bps;
  const buf = new ArrayBuffer(44 + dataSize), v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nch * bps, true); v.setUint16(32, nch * bps, true); v.setUint16(34, bits, true);
  ws(36, 'data'); v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nch; c++) {
    const s = Math.max(-1, Math.min(1, pcm.channels[c][i]));
    if (bits === 16) { v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    else { v.setFloat32(o, s, true); o += 4; }
  }
  return new Uint8Array(buf);
}
export function decodeWAV(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)); const sz = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(o + 8, true), nch: v.getUint16(o + 10, true), sr: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 'data') data = { off: o + 8, size: sz };
    o += 8 + sz + (sz & 1);
  }
  const bps = fmt.bits / 8, n = Math.floor(data.size / (bps * fmt.nch));
  const channels = Array.from({ length: fmt.nch }, () => new Float32Array(n));
  let p = data.off;
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.nch; c++) { channels[c][i] = fmt.bits === 16 ? v.getInt16(p, true) / 32768 : v.getFloat32(p, true); p += bps; }
  return { sampleRate: fmt.sr, channels };
}
