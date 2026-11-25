// WebCodecs-based encoders: OGG (Opus) and M4A (AAC). Feature-detected at runtime.
import { muxOggOpus } from './ogg.js';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export async function resamplePCM(pcm, rate) {
  if (pcm.sampleRate === rate) return pcm;
  const len = Math.ceil((pcm.channels[0].length * rate) / pcm.sampleRate);
  const oc = new OfflineAudioContext(pcm.channels.length, Math.max(1, len), rate);
  const b = oc.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate);
  pcm.channels.forEach((c, i) => b.copyToChannel(c, i));
  const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
  const r = await oc.startRendering();
  return { sampleRate: rate, channels: Array.from({ length: r.numberOfChannels }, (_, i) => r.getChannelData(i).slice()) };
}

export async function codecSupported(codec, sampleRate = 48000, numberOfChannels = 2) {
  if (typeof AudioEncoder === 'undefined') return false;
  try { const r = await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels, bitrate: 160000 }); return !!r.supported; } catch { return false; }
}

async function encodeWith(pcm, codec, bitrate, onChunk) {
  const nch = pcm.channels.length, sr = pcm.sampleRate, len = pcm.channels[0].length;
  let err = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => onChunk(chunk, meta), error: (e) => (err = e) });
  enc.configure({ codec, sampleRate: sr, numberOfChannels: nch, bitrate });
  const F = 4800;
  for (let i = 0; i < len; i += F) {
    const n = Math.min(F, len - i); const data = new Float32Array(n * nch);
    for (let c = 0; c < nch; c++) data.set(pcm.channels[c].subarray(i, i + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: nch, timestamp: Math.round((i / sr) * 1e6), data });
    enc.encode(ad); ad.close();
    if (enc.encodeQueueSize > 50) await new Promise((r) => setTimeout(r, 0));
  }
  await enc.flush(); enc.close();
  if (err) throw err;
}

export async function encodeOGG(pcm, bitrate = 160000) {
  const p = await resamplePCM(pcm, 48000);
  const packets = [];
  await encodeWith(p, 'opus', bitrate, (chunk) => { const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); packets.push({ data: d, samples: Math.round(((chunk.duration || 20000) / 1e6) * 48000) }); });
  return muxOggOpus(packets, { channels: p.channels.length, inputSampleRate: pcm.sampleRate });
}

export async function encodeM4A(pcm, bitrate = 192000) {
  const sr = [48000, 44100].includes(pcm.sampleRate) ? pcm.sampleRate : 48000;
  const p = await resamplePCM(pcm, sr);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: 'aac', numberOfChannels: p.channels.length, sampleRate: sr }, fastStart: 'in-memory' });
  await encodeWith(p, 'mp4a.40.2', bitrate, (chunk, meta) => muxer.addAudioChunk(chunk, meta));
  muxer.finalize();
  return new Uint8Array(muxer.target.buffer);
}
