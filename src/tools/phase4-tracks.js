// المرحلة 4: المسارات المتعددة، والدمج، والتلاشي المتقاطع
import { newTrack, getTrack, findClip, clipEnd, sortClips, TRACK_COLORS } from '../core/project.js';
import { uid } from '../core/ids.js';
import { h, dialog, promptDlg, confirmDlg, toast, slider } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** crossfade clip with the next clip on the same track (overlap them by `len` seconds). */
export function crossfadeClips(track, clipId, len) {
  sortClips(track);
  const i = track.clips.findIndex((c) => c.id === clipId); const a = track.clips[i], b = track.clips[i + 1];
  if (!a || !b) return false;
  const gap = b.start - clipEnd(a);
  if (gap > 0.05) return false;
  let overlap = -gap;
  if (overlap < len) { const shift = len - overlap; for (const c of track.clips.slice(i + 1)) c.start -= shift; overlap = len; }
  overlap = Math.min(overlap, a.duration, b.duration);
  a.fadeOut = overlap; b.fadeIn = overlap; a.fadeCurve = 'equal'; b.fadeCurve = 'equal';
  return true;
}

export function setup(app) {
  const { state } = app; const A = app.actions;
  A.addTrack = () => { app.commit('مسار جديد', (p) => { const t = newTrack(p.tracks.length); p.tracks.push(t); p.activeTrackId = t.id; }); if (app.view !== 'multi') app.setView('multi'); };
  A.importTrack = () => { app._importNewTrack = true; if (app.view !== 'multi') app.setView('multi'); document.getElementById('fileInput').click(); };
  A.moveTool = () => { app.timeline.tool = app.timeline.tool === 'move' ? 'select' : 'move'; if (app.view !== 'multi') app.setView('multi'); app.timeline.redraw(); app.renderToolbar(); if (app.timeline.tool === 'move') toast('اسحب أي مقطع لتحريكه زمنيًا أو إلى مسار آخر'); };
  A.moveClip = (clipId, start, trackId) => {
    app.commit('تحريك مقطع', (p) => {
      const f = findClip(p, clipId); if (!f) return;
      f.clip.start = Math.max(0, start);
      if (trackId && trackId !== f.track.id) { f.track.clips = f.track.clips.filter((c) => c.id !== clipId); getTrack(p, trackId).clips.push(f.clip); p.activeTrackId = trackId; }
      sortClips(getTrack(p, trackId || f.track.id));
    });
  };
  A.crossfade = async () => {
    const id = state.selectedClipId; if (!id) { toast('في واجهة الدمج: المس المقطع الأول (الذي يسبق الآخر) لتحديده'); return; }
    const sl = slider({ label: 'طول التلاشي المتقاطع', min: 0.1, max: 8, step: 0.1, value: 2, fmt: (v) => v.toFixed(1) + ' ث' });
    const ok = await dialog({ title: 'تلاشٍ متقاطع مع المقطع التالي', body: h('div', {}, h('p', { class: 'note' }, 'ينخفض المقطع المحدد في نهايته بينما يرتفع المقطع الذي يليه في المسار نفسه، فيتداخلان بنعومة.'), sl), actions: [{ label: 'إلغاء', value: false }, { label: 'طبّق', value: true, primary: true }] });
    if (!ok) return; let done = false;
    app.commit('تلاشٍ متقاطع', (p) => { const f = findClip(p, id); done = f && crossfadeClips(f.track, id, sl.get()); });
    if (!done) { app.undoSilent(); toast('لا يوجد مقطع ملاصق بعده في المسار نفسه. ضع المقطعين متتاليين أولًا.', 'error', 5000); }
  };
  A.dupTrack = () => { const src = app.track; app.commit('تكرار المسار', (p) => { const t = structuredClone(getTrack(p, src.id)); t.id = uid('trk'); t.name = src.name + ' (نسخة)'; t.clips.forEach((c) => (c.id = uid('clp'))); t.color = TRACK_COLORS[p.tracks.length % TRACK_COLORS.length]; p.tracks.splice(p.tracks.indexOf(getTrack(p, src.id)) + 1, 0, t); p.activeTrackId = t.id; }); };
  A.delTrack = async () => {
    const p = app.project; if (p.tracks.length < 2) { toast('لا يمكن حذف المسار الوحيد'); return; }
    const tr = app.track; if (!(await confirmDlg('حذف المسار', `حذف «${tr.name}»؟ (يمكنك التراجع)`, 'احذف'))) return;
    app.commit('حذف مسار', (pp) => { pp.tracks = pp.tracks.filter((t) => t.id !== tr.id); pp.activeTrackId = pp.tracks[0].id; });
  };
  A.renameTrack = async (id = app.track.id) => { const t = getTrack(app.project, id); const n = await promptDlg('اسم المسار', t.name, ['الأغنية', 'العود', 'الإيقاع', 'الصوت', 'الكلام', 'الموسيقى']); if (n) app.commit('تسمية مسار', (p) => (getTrack(p, id).name = n)); };
  A.delClip = () => { const id = state.selectedClipId; if (!id) return toast('المس مقطعًا لتحديده'); app.commit('حذف مقطع', (p) => { const f = findClip(p, id); if (f) f.track.clips = f.track.clips.filter((c) => c.id !== id); }); state.selectedClipId = null; };

  // live-adjustable track headers
  let liveTimer;
  const live = () => { clearTimeout(liveTimer); liveTimer = setTimeout(() => { if (app.player.playing && !app.player.preview) app.player.play(app.player.position(), app.player.range ? app.player.to : null, app.player.loop); }, 120); };
  app.renderHeaders = (root, tracks, laneH) => {
    root.innerHTML = ''; const p = app.project;
    for (const t of tracks) {
      let before = null;
      const snap = () => { if (!before) before = { volume: t.volume, pan: t.pan }; };
      const commitLive = (label, key) => { const v = t[key]; if (before) t[key] = before[key]; before = null; app.commit(label, (pp) => { getTrack(pp, t.id)[key] = v; }); };
      const vol = h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: t.volume, 'aria-label': 'مستوى المسار', oninput: (e) => { snap(); t.volume = +e.target.value; volOut.textContent = Math.round(t.volume * 100) + '%'; live(); }, onchange: () => commitLive('مستوى المسار', 'volume') });
      const volOut = h('span', {}, Math.round(t.volume * 100) + '%');
      const pan = h('input', { type: 'range', min: -1, max: 1, step: 0.05, value: t.pan, 'aria-label': 'يمين ويسار', oninput: (e) => { snap(); t.pan = +e.target.value; panOut.textContent = panLabel(t.pan); live(); }, onchange: () => commitLive('توزيع يمين/يسار', 'pan') });
      const panOut = h('span', {}, panLabel(t.pan));
      const row = h('div', { class: 'trk-h' + (t.id === p.activeTrackId ? ' active' : ''), style: { height: laneH + 'px' }, 'data-track': t.id, onclick: (e) => { if (e.target.closest('input,button')) return; app.timeline.onTrackActivate(t.id); } },
        h('div', { class: 'nm' }, h('span', { class: 'dot', style: { background: t.color } }), h('button', { type: 'button', class: 'tn', onclick: () => A.renameTrack(t.id) }, t.name),
          h('button', { type: 'button', class: 'ms m', 'aria-pressed': String(t.mute), title: 'كتم', onclick: () => { app.commit('كتم', (pp) => { const x = getTrack(pp, t.id); x.mute = !x.mute; }); live(); } }, 'كتم'),
          h('button', { type: 'button', class: 'ms s', 'aria-pressed': String(t.solo), title: 'عزف منفرد', onclick: () => { app.commit('منفرد', (pp) => { const x = getTrack(pp, t.id); x.solo = !x.solo; }); live(); } }, 'منفرد')),
        h('label', { class: 'mini' }, icon('Volume2', 16), vol, volOut),
        laneH > 100 ? h('label', { class: 'mini' }, icon('ArrowLeftRight', 16), pan, panOut) : null,
      );
      root.append(row);
    }
  };
  app.tab('tracks', 'المسارات', () => [
    { icon: 'Plus', label: 'مسار جديد', id: 'addTrack' },
    { icon: 'FilePlus', label: 'ملف في مسار جديد', id: 'importTrack' },
    { icon: 'Move', label: 'تحريك المقاطع', id: 'moveTool', pressed: () => app.timeline.tool === 'move' },
    { icon: 'Merge', label: 'تلاشٍ متقاطع', id: 'crossfade' },
    { icon: 'Trash2', label: 'حذف المقطع', id: 'delClip' },
    { icon: 'Copy', label: 'تكرار المسار', id: 'dupTrack' },
    { icon: 'Pencil', label: 'تسمية المسار', id: 'renameTrack' },
    { icon: 'X', label: 'حذف المسار', id: 'delTrack' },
  ], 40);
}
const panLabel = (v) => (Math.abs(v) < 0.03 ? 'وسط' : v < 0 ? `يسار ${Math.round(-v * 100)}` : `يمين ${Math.round(v * 100)}`);
