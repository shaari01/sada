import { describe, it, expect } from 'vitest';
import { denoise, hpss, humRemove, detectHum } from '../../src/dsp/spectral.js';
import { oggCRC, muxOggOpus } from '../../src/export/ogg.js';
import { crc32 } from '../../src/export/zip.js';
import { sine } from './helpers.js';
const SR = 16000;
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };

describe('noise & hum', () => {
  it('denoise lowers steady noise while keeping the tone', () => {
    const n = SR * 4, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = (Math.random() - 0.5) * 0.1; const t = sine(440, 2, SR, 0.5); for (let i = 0; i < t.length; i++) x[SR + i] += t[i];
    const y = denoise(x, SR, { strength: 1.2 });
    expect(rms(y, 0, SR / 2)).toBeLessThan(rms(x, 0, SR / 2) * 0.5);
    expect(rms(y, SR + 4000, 2 * SR)).toBeGreaterThan(rms(x, SR + 4000, 2 * SR) * 0.8);
  });
  it('detects and removes 60 Hz hum', () => { const x = sine(60, 3, SR, 0.3); expect(detectHum(x, SR)).toBe(60); const y = humRemove(x, SR, 'auto'); expect(rms(y, SR, 2 * SR)).toBeLessThan(0.05); });
});
describe('separation', () => {
  it('stems add back up to the original', () => {
    const L = sine(220, 1, SR, 0.3), R = sine(220, 1, SR, 0.3); for (let i = 0; i < L.length; i += 4000) { L[i] += 0.8; R[i] += 0.8; }
    const s = hpss([L, R], SR); const i = 5000;
    expect(s.vocals[0][i] + s.drums[0][i] + s.bass[0][i] + s.other[0][i]).toBeCloseTo(L[i], 4);
  });
});
describe('containers', () => {
  it('ogg crc of "OggS" page check', () => { expect(oggCRC(new Uint8Array([1, 2, 3]))).toBeTypeOf('number'); const o = muxOggOpus([{ data: new Uint8Array(10), samples: 960 }], { channels: 2 }); expect(String.fromCharCode(...o.subarray(0, 4))).toBe('OggS'); });
  it('zip crc32 known value', () => expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926));
});
