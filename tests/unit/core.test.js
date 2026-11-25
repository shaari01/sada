import { describe, it, expect } from 'vitest';
import { newProject, newClip, splitAt, deleteRange, copyRange, insertAt, insertSilence, reorderClips, trackEnd, replaceRange } from '../../src/core/project.js';
import { envValueAt, applyRamp, shape } from '../../src/core/envelope.js';
import { renderTrack } from '../../src/core/mix.js';
import { encodeWAV, decodeWAV } from '../../src/export/wav.js';

const mkTrack = (dur = 10) => { const p = newProject(); const t = p.tracks[0]; t.clips.push(newClip('s1', dur, 0, 0)); return t; };

describe('editing', () => {
  it('splits a clip', () => { const t = mkTrack(); splitAt(t, 4); expect(t.clips.length).toBe(2); expect(t.clips[1].offset).toBeCloseTo(4); expect(trackEnd(t)).toBeCloseTo(10); });
  it('deletes a range with ripple', () => { const t = mkTrack(); deleteRange(t, 2, 5); expect(trackEnd(t)).toBeCloseTo(7); expect(t.clips[1].offset).toBeCloseTo(5); expect(t.clips[1].start).toBeCloseTo(2); });
  it('deletes with crossfade keeping total length', () => { const t = mkTrack(); deleteRange(t, 2, 5, { crossfade: 0.1 }); expect(trackEnd(t)).toBeCloseTo(7); expect(t.clips[0].fadeOut).toBeCloseTo(0.1); expect(t.clips[1].fadeIn).toBeCloseTo(0.1); expect(t.clips[1].start).toBeCloseTo(1.95); });
  it('copies and pastes', () => { const t = mkTrack(); const cb = copyRange(t, 1, 3); insertAt(t, 5, cb); expect(trackEnd(t)).toBeCloseTo(12); const pasted = t.clips.find((c) => Math.abs(c.start - 5) < 1e-6 && Math.abs(c.offset - 1) < 1e-6); expect(pasted).toBeTruthy(); });
  it('inserts silence', () => { const t = mkTrack(); insertSilence(t, 3, 2); expect(trackEnd(t)).toBeCloseTo(12); expect(t.clips[1].start).toBeCloseTo(5); });
  it('reorders segments', () => { const t = mkTrack(); splitAt(t, 3); splitAt(t, 6); reorderClips(t, 2, 0); expect(t.clips[0].offset).toBeCloseTo(6); expect(t.clips[0].start).toBe(0); expect(t.clips[1].start).toBeCloseTo(4); });
  it('replaces a range with new duration', () => { const t = mkTrack(); replaceRange(t, 2, 4, 's2', 1); expect(trackEnd(t)).toBeCloseTo(9); expect(t.clips.some((c) => c.sourceId === 's2' && Math.abs(c.start - 2) < 1e-6)).toBe(true); });
});

describe('envelope', () => {
  it('interpolates and holds', () => { const e = [{ t: 0, v: 1 }, { t: 2, v: 0.3, curve: 'linear' }]; expect(envValueAt(e, 1)).toBeCloseTo(0.65); expect(envValueAt(e, 5)).toBeCloseTo(0.3); });
  it('ramp to level', () => { const e = applyRamp([], 3, 5, 1, 0.3, 'smooth'); expect(envValueAt(e, 1)).toBeCloseTo(1); expect(envValueAt(e, 4)).toBeCloseTo(0.65); expect(envValueAt(e, 10)).toBeCloseTo(0.3); });
  it('curve shapes', () => { expect(shape('fast', 0.5)).toBeGreaterThan(0.5); expect(shape('slow', 0.5)).toBeLessThan(0.5); expect(shape('smooth', 0.5)).toBeCloseTo(0.5); });
});

describe('mix & wav', () => {
  it('renders clips with fades', () => {
    const sr = 1000; const src = { sampleRate: sr, channels: [new Float32Array(2000).fill(1)] };
    const t = mkTrack(2); t.clips[0].fadeIn = 1;
    const r = renderTrack(t, 0, 2, () => src, sr);
    expect(r.channels[0][0]).toBeCloseTo(0); expect(r.channels[0][500]).toBeCloseTo(0.5, 1); expect(r.channels[1][1500]).toBeCloseTo(1);
  });
  it('wav roundtrip', () => { const p = { sampleRate: 8000, channels: [new Float32Array([0, 0.5, -0.5, 1])] }; const d = decodeWAV(encodeWAV(p)); expect(d.sampleRate).toBe(8000); expect(d.channels[0][1]).toBeCloseTo(0.5, 3); });
});
