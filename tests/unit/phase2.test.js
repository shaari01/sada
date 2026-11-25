import { describe, it, expect } from 'vitest';
import { speedPoints } from '../../src/tools/phase2-speed.js';
describe('speed points', () => {
  it('gradual linear from 1 to 1.3', () => { const p = speedPoints('gradual', { from: 1, to: 1.3, shape: 'linear' }); expect(p[0].s).toBe(1); expect(p.at(-1).s).toBeCloseTo(1.3); expect(p[8].s).toBeCloseTo(1.15); });
  it('fixed has no curve', () => expect(speedPoints('fixed', {})).toBeNull());
});
