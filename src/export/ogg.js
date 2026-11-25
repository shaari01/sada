// Minimal Ogg/Opus muxer (RFC 7845) for packets produced by WebCodecs AudioEncoder.
const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; } return t; })();
export function oggCRC(bytes) { let c = 0; for (let i = 0; i < bytes.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) & 0xff) ^ bytes[i]]) >>> 0; return c >>> 0; }

function page(packets, { granule, serial, seq, bos = false, eos = false, cont = false }) {
  const segs = [];
  for (const p of packets) { let n = p.length; while (n >= 255) { segs.push(255); n -= 255; } segs.push(n); }
  const bodyLen = packets.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(27 + segs.length + bodyLen), v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0); out[4] = 0; out[5] = (cont ? 1 : 0) | (bos ? 2 : 0) | (eos ? 4 : 0);
  v.setBigInt64(6, BigInt(granule), true); v.setUint32(14, serial, true); v.setUint32(18, seq, true); v.setUint32(22, 0, true);
  out[26] = segs.length; out.set(segs, 27);
  let o = 27 + segs.length; for (const p of packets) { out.set(p, o); o += p.length; }
  v.setUint32(22, oggCRC(out), true);
  return out;
}
export function muxOggOpus(packets, { channels, inputSampleRate = 48000, preSkip = 312, samplesPerPacket = 960 }) {
  const serial = (Math.random() * 0xffffffff) >>> 0; let seq = 0; const pages = [];
  const head = new Uint8Array(19), hv = new DataView(head.buffer);
  head.set([..."OpusHead"].map((c) => c.charCodeAt(0))); head[8] = 1; head[9] = channels; hv.setUint16(10, preSkip, true); hv.setUint32(12, inputSampleRate, true); hv.setInt16(16, 0, true); head[18] = 0;
  pages.push(page([head], { granule: 0, serial, seq: seq++, bos: true }));
  const vendor = new TextEncoder().encode('sada'); const tags = new Uint8Array(8 + 4 + vendor.length + 4), tv = new DataView(tags.buffer);
  tags.set([..."OpusTags"].map((c) => c.charCodeAt(0))); tv.setUint32(8, vendor.length, true); tags.set(vendor, 12); tv.setUint32(12 + vendor.length, 0, true);
  pages.push(page([tags], { granule: 0, serial, seq: seq++ }));
  let granule = 0, batch = [], batchSegs = 0;
  packets.forEach((p, i) => {
    const segs = Math.floor(p.data.length / 255) + 1;
    if (batchSegs + segs > 255 && batch.length) { pages.push(page(batch, { granule, serial, seq: seq++ })); batch = []; batchSegs = 0; }
    batch.push(p.data); batchSegs += segs; granule += p.samples ?? samplesPerPacket;
    if (i === packets.length - 1) pages.push(page(batch, { granule, serial, seq: seq++, eos: true }));
  });
  const total = pages.reduce((s, p) => s + p.length, 0), out = new Uint8Array(total); let o = 0; for (const p of pages) { out.set(p, o); o += p.length; }
  return out;
}
