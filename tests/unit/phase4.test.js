import { describe, it, expect } from 'vitest';
import { newProject, newClip, newTrack } from '../../src/core/project.js';
import { crossfadeClips } from '../../src/tools/phase4-tracks.js';
describe('crossfade', () => {
  it('overlaps adjacent clips and sets equal-power fades', () => {
    const t = newTrack(0); t.clips.push(newClip('a', 5, 0), newClip('b', 5, 5), newClip('c', 2, 10));
    expect(crossfadeClips(t, t.clips[0].id, 2)).toBe(true);
    expect(t.clips[1].start).toBeCloseTo(3); expect(t.clips[2].start).toBeCloseTo(8); expect(t.clips[0].fadeOut).toBe(2); expect(t.clips[1].fadeIn).toBe(2);
  });
  it('refuses a far gap', () => { const t = newTrack(0); t.clips.push(newClip('a', 5, 0), newClip('b', 5, 9)); expect(crossfadeClips(t, t.clips[0].id, 2)).toBe(false); });
});
