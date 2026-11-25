import { describe, it, expect } from 'vitest';
import { timeStretch, pitchShift, speedCurve, speedAndPitch } from '../../src/dsp/wsola.js';
import { detectBPM, detectKey, keyShift } from '../../src/dsp/analysis.js';
import { sine, zeroCrossFreq, clickTrack } from './helpers.js';
const SR = 44100;

describe('time stretch / pitch', () => {
  it('2x speed halves duration, keeps pitch', () => { const x = sine(440, 4, SR); const [y] = timeStretch([x], SR, 2); expect(y.length / x.length).toBeCloseTo(0.5, 1); expect(zeroCrossFreq(y.subarray(4000, y.length - 4000), SR)).toBeCloseTo(440, -1); });
  it('0.5x speed doubles duration, keeps pitch', () => { const x = sine(300, 2, SR); const [y] = timeStretch([x], SR, 0.5); expect(y.length / x.length).toBeCloseTo(2, 1); expect(Math.abs(zeroCrossFreq(y.subarray(4000, y.length - 4000), SR) - 300)).toBeLessThan(8); });
  it('gradual speed 1→1.5 gives intermediate length', () => { const x = sine(440, 4, SR); const [y] = timeStretch([x], SR, speedCurve([{ u: 0, s: 1 }, { u: 1, s: 1.5 }])); const ratio = y.length / x.length; expect(ratio).toBeGreaterThan(0.75); expect(ratio).toBeLessThan(0.88); expect(Math.abs(zeroCrossFreq(y.subarray(4000, y.length - 4000), SR) - 440)).toBeLessThan(8); });
  it('pitch +12 doubles frequency, keeps duration', () => { const x = sine(220, 2, SR); const [y] = pitchShift([x], SR, 12); expect(y.length).toBe(x.length); expect(Math.abs(zeroCrossFreq(y.subarray(4000, y.length - 6000), SR) - 440)).toBeLessThan(12); });
  it('speed+pitch together', () => { const x = sine(220, 3, SR); const [y] = speedAndPitch([x], SR, 1.25, -12); expect(y.length / x.length).toBeCloseTo(0.8, 1); expect(Math.abs(zeroCrossFreq(y.subarray(4000, y.length - 6000), SR) - 110)).toBeLessThan(6); });
});

describe('analysis', () => {
  for (const bpm of [90, 120, 128]) it(`detects ${bpm} BPM`, () => { const r = detectBPM(clickTrack(bpm, 20, SR), SR); expect(Math.abs(r.bpm - bpm)).toBeLessThan(2); });
  it('detects key A minor vs C major relation', () => {
    const notes = [440, 523.25, 659.25, 220]; const x = new Float32Array(SR * 6); for (const f of notes) { const s = sine(f, 6, SR, 0.2); for (let i = 0; i < x.length; i++) x[i] += s[i]; }
    const k = detectKey(x, SR); expect(k.tonic === 9 || k.tonic === 0).toBe(true);
  });
  it('key shift', () => { expect(keyShift({ tonic: 0, mode: 'major' }, { tonic: 2, mode: 'major' })).toBe(2); expect(keyShift({ tonic: 9, mode: 'minor' }, { tonic: 0, mode: 'major' })).toBe(0); expect(keyShift({ tonic: 0, mode: 'major' }, { tonic: 10, mode: 'major' })).toBe(-2); });
});
