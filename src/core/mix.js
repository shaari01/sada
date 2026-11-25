import { createPCM } from './pcm.js';
import { clipEnd, audibleTracks } from './project.js';
import { envValueAt } from './envelope.js';

export function fadeGain(clip, tInClip) {
  let g = clip.gain ?? 1;
  const eq = clip.fadeCurve === 'equal';
  if (clip.fadeIn > 0 && tInClip < clip.fadeIn) { const x = tInClip / clip.fadeIn; g *= eq ? Math.sin((x * Math.PI) / 2) : x; }
  const rem = clip.duration - tInClip;
  if (clip.fadeOut > 0 && rem < clip.fadeOut) { const x = Math.max(0, rem / clip.fadeOut); g *= eq ? Math.sin((x * Math.PI) / 2) : x; }
  return g;
}

/** Pure-JS render of one track over [a,b] (clip gains+fades; optionally envelope/volume/pan). */
export function renderTrack(track, a, b, getSource, sampleRate, { envelope = false, volume = false, channels = 2 } = {}) {
  const n = Math.max(0, Math.round((b - a) * sampleRate));
  const out = createPCM(sampleRate, channels, n);
  for (const c of track.clips) {
    const s = Math.max(a, c.start), e = Math.min(b, clipEnd(c));
    if (e <= s) continue;
    const src = getSource(c.sourceId);
    if (!src) continue;
    const i0 = Math.round((s - a) * sampleRate), i1 = Math.min(n, Math.round((e - a) * sampleRate));
    const srcStart = (c.offset + (s - c.start)) * src.sampleRate;
    const step = src.sampleRate / sampleRate;
    for (let ch = 0; ch < channels; ch++) {
      const sch = src.channels[Math.min(ch, src.channels.length - 1)];
      const och = out.channels[ch];
      for (let i = i0; i < i1; i++) {
        const si = Math.round(srcStart + (i - i0) * step);
        if (si < 0 || si >= sch.length) continue;
        const tIn = (s - c.start) + (i - i0) / sampleRate;
        och[i] += sch[si] * fadeGain(c, tIn);
      }
    }
  }
  if (envelope || volume) {
    const vol = volume ? track.volume : 1;
    for (let i = 0; i < n; i++) {
      const g = vol * (envelope ? envValueAt(track.envelope, a + i / sampleRate) : 1);
      for (const ch of out.channels) ch[i] *= g;
    }
    if (volume && channels === 2 && track.pan) {
      const p = (track.pan + 1) * Math.PI / 4; const L = Math.cos(p) * Math.SQRT2, R = Math.sin(p) * Math.SQRT2;
      const l = out.channels[0], r = out.channels[1];
      for (let i = 0; i < n; i++) { l[i] *= Math.min(1, L); r[i] *= Math.min(1, R); }
    }
  }
  return out;
}

/** Full project mix in pure JS (used for analysis such as ducking/BPM, not for final export). */
export function renderMix(project, a, b, getSource) {
  const sr = project.sampleRate;
  const out = createPCM(sr, 2, Math.round((b - a) * sr));
  for (const t of audibleTracks(project)) {
    const r = renderTrack(t, a, b, getSource, sr, { envelope: true, volume: true });
    for (let c = 0; c < 2; c++) { const o = out.channels[c], x = r.channels[c]; for (let i = 0; i < o.length; i++) o[i] += x[i]; }
  }
  return out;
}
