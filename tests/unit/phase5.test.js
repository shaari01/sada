import { describe, it, expect } from 'vitest';
import { tempoRatio } from '../../src/tools/phase5-rhythm.js';
describe('tempo ratio', () => { it('prefers half/double time', () => { expect(tempoRatio(120, 100)).toBeCloseTo(1.2); expect(tempoRatio(120, 240)).toBeCloseTo(1); expect(tempoRatio(90, 200)).toBeCloseTo(0.9); }); });
