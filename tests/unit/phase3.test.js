import { describe, it, expect } from 'vitest';
import { voiceActivity, duckEnvelope } from '../../src/core/duck.js';
import { envValueAt } from '../../src/core/envelope.js';
import { bakeFade } from '../../src/tools/phase3-level.js';
describe('ducking', () => {
  it('finds speech segments and lowers music under them', () => {
    const sr = 8000, x = new Float32Array(sr * 10);
    for (let i = 2 * sr; i < 4 * sr; i++) x[i] = 0.5 * Math.sin(i / 3); for (let i = 7 * sr; i < 8 * sr; i++) x[i] = 0.5 * Math.sin(i / 3);
    const segs = voiceActivity(x, sr); expect(segs.length).toBe(2); expect(segs[0][0]).toBeCloseTo(2, 0);
    const env = duckEnvelope(segs, { level: 0.3 }); expect(envValueAt(env, 3)).toBeCloseTo(0.3); expect(envValueAt(env, 6)).toBeCloseTo(1); expect(envValueAt(env, 7.5)).toBeCloseTo(0.3);
  });
});
describe('fades', () => { it('fade in starts silent', () => { const p = { sampleRate: 100, channels: [new Float32Array(100).fill(1)] }; bakeFade(p, 'in'); expect(p.channels[0][0]).toBe(0); expect(p.channels[0][99]).toBeCloseTo(1); }); });
