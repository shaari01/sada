import { speedAndPitch, speedCurve } from './wsola.js';
import { detectBPM, detectKey } from './analysis.js';
import { denoise, hpss, humRemove } from './spectral.js';
import { encodeMP3 } from '../export/mp3.js';

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  const progress = (p) => self.postMessage({ id, progress: p });
  try {
    let result, transfer = [];
    if (op === 'speedPitch') {
      const { channels, sampleRate, speed, curvePoints, semitones } = args;
      const sp = curvePoints ? speedCurve(curvePoints) : speed;
      result = speedAndPitch(channels, sampleRate, sp, semitones, { onProgress: progress });
      transfer = result.map((c) => c.buffer);
    } else if (op === 'bpm') result = detectBPM(args.mono, args.sampleRate);
    else if (op === 'key') result = detectKey(args.mono, args.sampleRate);
    else if (op === 'denoise') { result = args.channels.map((c) => denoise(c, args.sampleRate, args)); transfer = result.map((c) => c.buffer); }
    else if (op === 'hum') { result = args.channels.map((c) => humRemove(c, args.sampleRate, args.freq)); transfer = result.map((c) => c.buffer); }
    else if (op === 'hpss') { result = hpss(args.channels, args.sampleRate, progress); }
    else if (op === 'mp3') { result = encodeMP3(args.pcm, args.kbps, progress); transfer = [result.buffer]; }
    else throw new Error('unknown op ' + op);
    self.postMessage({ id, result }, transfer);
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
