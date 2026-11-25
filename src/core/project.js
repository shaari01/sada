import { uid } from './ids.js';
import { shiftEnv } from './envelope.js';

export const TRACK_COLORS = ['#2f80ed', '#eb5757', '#27ae60', '#f2994a', '#9b51e0', '#00a3a3', '#d4a017', '#e84393'];
export const EPS = 1e-6;

export function newProject(name = 'مشروع جديد', sampleRate = 48000) {
  const t = newTrack(0);
  return { id: uid('prj'), name, sampleRate, tracks: [t], markers: [], bpm: null, beatOffset: 0, grid: false, key: null, activeTrackId: t.id, created: Date.now(), updated: Date.now(), version: 1 };
}
export function newTrack(index = 0, name) {
  return { id: uid('trk'), name: name || `مسار ${index + 1}`, color: TRACK_COLORS[index % TRACK_COLORS.length], volume: 1, pan: 0, mute: false, solo: false, envelope: [], clips: [] };
}
export function newClip(sourceId, duration, start = 0, offset = 0, extra = {}) {
  return { id: uid('clp'), sourceId, offset, duration, start, gain: 1, fadeIn: 0, fadeOut: 0, ...extra };
}
export const clipEnd = (c) => c.start + c.duration;
export function trackEnd(track) { return track.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0); }
export function projectDuration(p) { return p.tracks.reduce((m, t) => Math.max(m, trackEnd(t)), 0); }
export const getTrack = (p, id) => p.tracks.find((t) => t.id === id);
export const activeTrack = (p) => getTrack(p, p.activeTrackId) || p.tracks[0];
export function findClip(p, clipId) {
  for (const t of p.tracks) { const c = t.clips.find((x) => x.id === clipId); if (c) return { track: t, clip: c }; }
  return null;
}
export const sortClips = (track) => track.clips.sort((a, b) => a.start - b.start);

/** split the clip containing time t (strictly inside) into two. returns track (mutated). */
export function splitAt(track, t) {
  const out = [];
  for (const c of track.clips) {
    if (t > c.start + EPS && t < clipEnd(c) - EPS) {
      const d1 = t - c.start;
      const a = { ...c, duration: d1, fadeOut: 0 };
      const b = { ...c, id: uid('clp'), start: t, offset: c.offset + d1, duration: c.duration - d1, fadeIn: 0 };
      a.fadeIn = Math.min(c.fadeIn, d1); b.fadeOut = Math.min(c.fadeOut, b.duration);
      out.push(a, b);
    } else out.push(c);
  }
  track.clips = out;
  sortClips(track);
  return track;
}

function shiftAfter(track, t, delta) {
  for (const c of track.clips) if (c.start >= t - EPS) c.start = Math.max(0, c.start + delta);
}

/** Delete [a,b] from a track. ripple: close the gap. crossfade (s): join with an equal-power crossfade. */
export function deleteRange(track, a, b, { ripple = true, crossfade = 0 } = {}) {
  if (b - a < EPS) return track;
  splitAt(track, a); splitAt(track, b);
  const removed = track.clips.filter((c) => c.start >= a - EPS && clipEnd(c) <= b + EPS);
  track.clips = track.clips.filter((c) => !removed.includes(c));
  if (ripple) {
    shiftAfter(track, b, -(b - a));
    track.envelope = shiftEnv(track.envelope, b, -(b - a), a, b);
    if (crossfade > 0) {
      const left = track.clips.find((c) => Math.abs(clipEnd(c) - a) < 1e-4);
      const right = track.clips.find((c) => Math.abs(c.start - a) < 1e-4);
      if (left && right) {
        // borrow half the crossfade from the deleted audio on each side (only when same source & contiguous material exists)
        const h = Math.min(crossfade / 2, (b - a) / 2, right.offset, left.duration / 2, right.duration / 2);
        if (h > 0.001) {
          left.duration += h; left.fadeOut = 2 * h; left.fadeCurve = 'equal';
          right.start -= h; right.offset -= h; right.duration += h; right.fadeIn = 2 * h; right.fadeCurve = 'equal';
        }
      }
    }
  } else {
    track.envelope = track.envelope.filter((p) => p.t < a || p.t > b);
  }
  sortClips(track);
  return track;
}

/** copy [a,b] → clipboard {duration, clips (start relative to a)} */
export function copyRange(track, a, b) {
  const clips = [];
  for (const c of track.clips) {
    const s = Math.max(a, c.start), e = Math.min(b, clipEnd(c));
    if (e - s > EPS) clips.push({ ...c, id: uid('clp'), start: s - a, offset: c.offset + (s - c.start), duration: e - s, fadeIn: s === c.start ? c.fadeIn : 0, fadeOut: e === clipEnd(c) ? c.fadeOut : 0 });
  }
  return { duration: b - a, clips };
}

/** insert clipboard at t, pushing later material right (ripple). */
export function insertAt(track, t, clip, { ripple = true } = {}) {
  splitAt(track, t);
  if (ripple) { shiftAfter(track, t, clip.duration); track.envelope = shiftEnv(track.envelope, t, clip.duration); }
  for (const c of clip.clips) track.clips.push({ ...c, id: uid('clp'), start: c.start + t });
  sortClips(track);
  return track;
}
export function insertSilence(track, t, dur) { return insertAt(track, t, { duration: dur, clips: [] }); }

/** replace [a,b] with a single new clip (e.g. processed audio), new duration may differ. */
export function replaceRange(track, a, b, sourceId, newDuration) {
  deleteRange(track, a, b, { ripple: true });
  insertAt(track, a, { duration: newDuration, clips: [newClip(sourceId, newDuration, 0, 0)] });
  return track;
}

/** Segments (cards) for the single view: clips in order. Reorder and re-pack contiguously. */
export function reorderClips(track, from, to) {
  sortClips(track);
  const arr = track.clips.slice();
  const [m] = arr.splice(from, 1);
  arr.splice(to, 0, m);
  let t = 0;
  for (const c of arr) { c.start = t; t += c.duration; }
  track.clips = arr;
  return track;
}

export function shiftMarkers(p, from, delta, removeA = null, removeB = null) {
  p.markers = p.markers.filter((m) => removeA == null || m.t < removeA || m.t > removeB).map((m) => (m.t >= from ? { ...m, t: Math.max(0, m.t + delta) } : m));
}

export function referencedSources(p) {
  const s = new Set();
  for (const t of p.tracks) for (const c of t.clips) s.add(c.sourceId);
  return s;
}
export function audibleTracks(p) {
  const anySolo = p.tracks.some((t) => t.solo);
  return p.tracks.filter((t) => !t.mute && (!anySolo || t.solo));
}
