// Shared application context used by all tool modules.
import { state, commit, emit, addSource, getSource, onChange } from './storage/store.js';
import { Player, decodeFile } from './audio/engine.js';
import { activeTrack, trackEnd, replaceRange, projectDuration, findClip, clipEnd, shiftMarkers } from './core/project.js';
import { renderTrack } from './core/mix.js';
import { pcmDuration } from './core/pcm.js';
import { uid } from './core/ids.js';
import { toast, progressDlg } from './ui/dom.js';

export const app = {
  state, commit, emit, addSource, getSource, onChange, toast,
  tabs: [], tabTools: new Map(),
  player: new Player(() => state.project, (id) => getSource(id)),
  get project() { return state.project; },
  get track() { return activeTrack(state.project); },
  /** register a toolbar tab; tools() returns an array of button descriptors */
  tab(id, label, tools, order = 50) { this.tabs.push({ id, label, order }); this.tabs.sort((a, b) => a.order - b.order); this.tabTools.set(id, tools); },
  /** current working range on the active track: selection, else selected clip, else whole track */
  range({ allowWhole = true } = {}) {
    const s = state.selection; if (s && s[1] - s[0] > 0.005) return { a: s[0], b: s[1], kind: 'selection' };
    if (state.selectedClipId) { const f = findClip(state.project, state.selectedClipId); if (f && f.track.id === state.project.activeTrackId) return { a: f.clip.start, b: clipEnd(f.clip), kind: 'clip' }; }
    if (!allowWhole) return null;
    const e = trackEnd(this.track); return e > 0 ? { a: 0, b: e, kind: 'track' } : null;
  },
  renderRange(a, b, track = this.track) { return renderTrack(track, a, b, getSource, state.project.sampleRate, { channels: 2 }); },
  /** Process [range] of the active track through fn(pcm) → pcm, replacing it (length may change). */
  async processRange(label, fn, { range = this.range(), progressTitle } = {}) {
    if (!range) { toast('لا يوجد صوت في هذا المسار', 'error'); return null; }
    const pg = progressTitle ? progressDlg(progressTitle) : null;
    try {
      const input = this.renderRange(range.a, range.b);
      const out = await fn(input, (p) => pg?.set(p));
      if (!out) return null;
      const id = addSource(uid('src'), out, { name: label });
      const nd = pcmDuration(out), trackId = state.project.activeTrackId;
      commit(label, (p) => {
        const tr = p.tracks.find((t) => t.id === trackId);
        replaceRange(tr, range.a, range.b, id, nd);
        if (p.tracks.length === 1 && Math.abs(nd - (range.b - range.a)) > 1e-3) shiftMarkers(p, range.b, nd - (range.b - range.a), range.a + nd, range.b);
      });
      state.selection = [range.a, range.a + nd]; state.selectedClipId = null;
      emit('selection');
      return out;
    } catch (e) { console.error(e); toast('تعذّر التنفيذ: ' + e.message, 'error', 5000); return null; }
    finally { pg?.close(); }
  },
  async importFiles(files, { newTrack = false, at = null } = {}) {
    const { importFiles } = await import('./tools/files.js');
    return importFiles(this, files, { newTrack, at });
  },
  decodeFile, projectDuration: () => projectDuration(state.project),
  stopPlayback() { this.player.stop(); },
};
window.sada = app; // handy for debugging & automated browser tests
