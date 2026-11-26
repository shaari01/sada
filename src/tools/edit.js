import { getTrack, copyRange, deleteRange, insertAt, insertSilence, splitAt, trackEnd, shiftMarkers, projectDuration } from '../core/project.js';
import { uid } from '../core/ids.js';
import { promptDlg, dialog, h, slider, toast, confirmDlg } from '../ui/dom.js';
import { livePreview } from '../ui/preview.js';
import { renderTrack } from '../core/mix.js';

export const MARKER_PRESETS = ['بداية المقطع', 'المذهب', 'الكوبليه', 'اللازمة', 'الختام', 'بداية الغناء'];

export function setupEdit(app) {
  const { state } = app;
  const op = (label, fn) => { const tid = state.project.activeTrackId; return app.commit(label, (p) => fn(p, getTrack(p, tid))); };
  const needSel = () => { const s = state.selection; if (!s || s[1] - s[0] < 0.005) { toast('حدّد جزءًا من الموجة أولًا بالسحب عليه'); return null; } return s; };
  const single = (p) => p.tracks.length === 1;

  const A = app.actions = app.actions || {};
  A.open = () => document.getElementById('fileInput').click();
  A.copy = () => { const s = needSel(); if (!s) return; state.clipboard = copyRange(app.track, s[0], s[1]); toast('نُسخ الجزء المحدد'); };
  A.cut = () => { const s = needSel(); if (!s) return; state.clipboard = copyRange(app.track, s[0], s[1]); op('قص', (p, t) => { deleteRange(t, s[0], s[1], { crossfade: 0.01 }); if (single(p)) shiftMarkers(p, s[1], -(s[1] - s[0]), s[0], s[1]); }); state.selection = null; state.cursor = s[0]; app.emit('selection'); };
  A.del = () => { const s = needSel(); if (!s) return; op('حذف', (p, t) => { deleteRange(t, s[0], s[1], { crossfade: 0.01 }); if (single(p)) shiftMarkers(p, s[1], -(s[1] - s[0]), s[0], s[1]); }); state.selection = null; state.cursor = s[0]; app.emit('selection'); };
  A.shorten = async () => {
    const s = needSel(); if (!s) return;
    const sl = slider({ label: 'طول التلاشي', min: 10, max: 500, step: 10, value: 80, fmt: (v) => v + ' م.ث' });
    const pa = Math.max(0, s[0] - 3);
    const pv = livePreview(app, { range: { a: pa, b: s[0] + 3 }, source: async () => ({ sampleRate: 1, channels: [new Float32Array(1)] }),
      process: () => { const t = structuredClone(app.track); deleteRange(t, s[0], s[1], { crossfade: sl.get() / 1000 }); return renderTrack(t, pa, Math.min(trackEnd(t), s[0] + 3), app.getSource, state.project.sampleRate); } });
    const body = h('div', {}, h('p', { class: 'note' }, `سيُحذف الجزء المحدد (${(s[1] - s[0]).toFixed(2)} ث) ويُوصل ما قبله بما بعده بتلاشٍ متقاطع حتى لا يُسمع القطع. المعاينة تُسمعك 3 ثوانٍ قبل الوصلة و3 بعدها.`), sl, pv);
    const ok = await dialog({ title: 'تقصير بتلاشٍ متقاطع', body, onOpen: () => pv.attach(body), actions: [{ label: 'إلغاء', value: false }, { label: 'اعتماد', value: true, primary: true }] });
    pv.stop();
    if (!ok) return;
    op('تقصير', (p, t) => { deleteRange(t, s[0], s[1], { crossfade: sl.get() / 1000 }); if (single(p)) shiftMarkers(p, s[1], -(s[1] - s[0]), s[0], s[1]); });
    state.selection = null; state.cursor = s[0]; app.emit('selection');
  };
  A.paste = () => {
    const cb = state.clipboard; if (!cb) { toast('لا يوجد شيء منسوخ بعد'); return; }
    const s = state.selection; const at = s && s[1] > s[0] ? s[0] : state.cursor;
    op('لصق', (p, t) => { if (s && s[1] > s[0]) deleteRange(t, s[0], s[1]); insertAt(t, at, cb); if (single(p)) shiftMarkers(p, at, cb.duration - (s && s[1] > s[0] ? s[1] - s[0] : 0)); });
    state.selection = [at, at + cb.duration]; app.emit('selection');
  };
  A.trim = () => { const s = needSel(); if (!s) return; op('إبقاء المحدد فقط', (p, t) => { const e = trackEnd(t); if (e > s[1]) deleteRange(t, s[1], e); deleteRange(t, 0, s[0]); if (single(p)) { p.markers = p.markers.filter((m) => m.t >= s[0] && m.t <= s[1]).map((m) => ({ ...m, t: m.t - s[0] })); } }); state.selection = [0, s[1] - s[0]]; state.cursor = 0; app.emit('selection'); };
  A.silence = async () => {
    const sl = slider({ label: 'المدة', min: 0.1, max: 10, step: 0.1, value: 1, fmt: (v) => v.toFixed(1) + ' ث' });
    const ok = await dialog({ title: 'إدراج صمت', body: h('div', {}, h('p', { class: 'note' }, 'يُدرج الصمت عند المؤشر ويُزاح ما بعده.'), sl), actions: [{ label: 'إلغاء', value: false }, { label: 'أدرج', value: true, primary: true }] });
    if (!ok) return; const at = state.cursor, d = sl.get();
    op('إدراج صمت', (p, t) => { insertSilence(t, at, d); if (single(p)) shiftMarkers(p, at, d); });
  };
  A.split = () => {
    const s = state.selection; const pts = s && s[1] > s[0] ? [s[0], s[1]] : [state.cursor];
    op('تقسيم', (p, t) => { for (const x of pts) splitAt(t, x); });
    toast('قُسّم المقطع: يمكنك الآن ترتيب البطاقات بالسحب');
  };
  A.marker = async () => {
    const name = await promptDlg('علامة جديدة عند ' + state.cursor.toFixed(2) + ' ث', MARKER_PRESETS[Math.min(state.project.markers.length, MARKER_PRESETS.length - 1)], MARKER_PRESETS);
    if (!name) return; const t = state.cursor;
    app.commit('علامة', (p) => { p.markers.push({ id: uid('mrk'), t, name }); p.markers.sort((a, b) => a.t - b.t); });
  };
  A.markerTap = async (m) => {
    const r = await dialog({ title: 'العلامة: ' + m.name, body: h('p', {}, 'عند ' + m.t.toFixed(2) + ' ث'), actions: [{ label: 'انتقل إليها', value: 'go', primary: true }, { label: 'حدّد حتى العلامة التالية', value: 'sel' }, { label: 'إعادة تسمية', value: 'ren' }, { label: 'حذف', value: 'del', danger: true }] });
    if (r === 'go') { state.cursor = m.t; app.emit('selection'); }
    else if (r === 'sel') { const next = state.project.markers.find((x) => x.t > m.t + 1e-6); state.selection = [m.t, next ? next.t : projectDuration(state.project)]; state.cursor = m.t; app.emit('selection'); }
    else if (r === 'ren') { const n = await promptDlg('اسم العلامة', m.name, MARKER_PRESETS); if (n) app.commit('تسمية علامة', (p) => { const x = p.markers.find((y) => y.id === m.id); if (x) x.name = n; }); }
    else if (r === 'del') app.commit('حذف علامة', (p) => { p.markers = p.markers.filter((y) => y.id !== m.id); });
  };
  A.selectAll = () => { const e = trackEnd(app.track); if (e > 0) { state.selection = [0, e]; app.emit('selection'); } };
  A.clearTrack = async () => { if (await confirmDlg('مسح المسار', 'هل تريد حذف كل الصوت في هذا المسار؟ (يمكنك التراجع)')) op('مسح المسار', (p, t) => { t.clips = []; t.envelope = []; }); };

  app.tab('edit', 'تحرير', () => [
    { icon: 'FolderOpen', label: 'فتح ملف', id: 'open' },
    { icon: 'Scissors', label: 'قص', id: 'cut' },
    { icon: 'Copy', label: 'نسخ', id: 'copy' },
    { icon: 'ClipboardPaste', label: 'لصق', id: 'paste' },
    { icon: 'Trash2', label: 'حذف', id: 'del' },
    { icon: 'Shrink', label: 'تقصير بتلاشٍ', id: 'shorten' },
    { icon: 'Crop', label: 'إبقاء المحدد', id: 'trim' },
    { icon: 'Split', label: 'تقسيم', id: 'split' },
    { icon: 'Minus', label: 'إدراج صمت', id: 'silence' },
    { icon: 'Flag', label: 'علامة', id: 'marker' },
    { icon: 'ChevronsLeftRight', label: 'تحديد الكل', id: 'selectAll' },
  ], 10);
}
