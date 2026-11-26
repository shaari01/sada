// المكتبة: أصوات المستخدم ومقاطعه، وغرف التردد الخاصة به، وقوالبه — يضيفها ويحذفها بنفسه،
// ويستطيع إخفاء الإعدادات الجاهزة التي لا يريدها (وإرجاعها).
import { loadAssets, listAssets, addAsset, deleteAsset, renameAsset, onAssets, isHidden, setHidden } from '../storage/assets.js';
import { REVERBS, EQ_PRESETS } from '../audio/effects.js';
import { COMP_PRESETS } from './phase6-effects.js';
import { insertAt, newTrack, newClip, getTrack } from '../core/project.js';
import { audioCtx } from '../audio/engine.js';
import { pcmDuration } from '../core/pcm.js';
import { uid } from '../core/ids.js';
import { dialog, h, segmented, toast, progressDlg, confirmDlg, promptDlg, fmtTime } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const FX_NAMES = { gain: 'تضخيم', normalize: 'تطبيع', comp: 'ضاغط', eq: 'معادل الصوت', echo: 'صدى', reverb: 'تردد', denoise: 'إزالة الضوضاء' };
export const BUILTINS = [
  ...Object.entries(REVERBS).map(([k, v]) => ({ key: 'reverb:' + k, fx: 'reverb', label: v.label })),
  ...Object.entries(EQ_PRESETS).map(([k, v]) => ({ key: 'eq:' + k, fx: 'eq', label: v.label })),
  ...Object.entries(COMP_PRESETS).map(([k, v]) => ({ key: 'comp:' + k, fx: 'comp', label: v.label })),
];
const MAX_IR_SEC = 12;

function pickFiles(accept = 'audio/*,video/*,.mp3,.wav,.m4a,.ogg,.opus,.flac,.aac,.webm') {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept, multiple: true, hidden: true });
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    inp.addEventListener('cancel', () => { res([]); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}
const stereo = (pcm) => (pcm.channels.length > 2 ? { sampleRate: pcm.sampleRate, channels: pcm.channels.slice(0, 2) } : pcm);
const baseName = (n) => n.replace(/\.[^.]+$/, '');

export function setup(app) {
  const A = app.actions; const { state } = app;
  loadAssets();

  /** add audio files to the library as sounds or reverb rooms */
  async function addFiles(files, kind) {
    files = [...files].filter(Boolean); if (!files.length) return [];
    const pg = progressDlg(kind === 'ir' ? 'إضافة غرفة تردد' : 'إضافة إلى المكتبة'); const out = [];
    try {
      for (const f of files) {
        pg.set(null, `جارٍ قراءة «${f.name}»…`);
        let pcm; try { pcm = stereo(await app.decodeFile(f)); } catch { toast(`تعذّر فتح «${f.name}»`, 'error', 4000); continue; }
        if (kind === 'ir') { const n = Math.min(pcm.channels[0].length, Math.round(MAX_IR_SEC * pcm.sampleRate)); pcm = { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice(0, n)) }; }
        out.push(await addAsset({ kind, name: baseName(f.name), pcm, duration: pcmDuration(pcm) }));
      }
    } finally { pg.close(); }
    if (out.length) toast(kind === 'ir' ? `أُضيفت ${out.length} غرفة. تجدها في «تردد».` : `أُضيف ${out.length} إلى «أصواتي»`);
    return out;
  }
  app.addLibraryFiles = addFiles;

  A.libAddSound = async () => addFiles(await pickFiles(), 'sound');
  A.libAddIR = async () => addFiles(await pickFiles('audio/*,.wav,.flac,.mp3,.ogg'), 'ir');
  A.libSaveSel = async () => {
    const r = app.range({ allowWhole: false }); if (!r) return toast('حدّد جزءًا من الموجة أولًا');
    const name = await promptDlg('اسم المقطع في مكتبتك', `مقطع ${fmtTime(r.a, false)}`); if (!name) return;
    const pcm = app.renderRange(r.a, r.b);
    await addAsset({ kind: 'sound', name, pcm, duration: pcmDuration(pcm) }); toast(`حُفظ «${name}» في «أصواتي»`);
  };

  /** put a library sound into the project: at the cursor of the active track, or on a new track */
  function useSound(a, where = 'cursor') {
    const id = app.addSource(uid('src'), a.pcm, { name: a.name }); const d = pcmDuration(a.pcm); const at = state.cursor;
    app.commit(`إدراج ${a.name}`, (p) => {
      if (!p.sampleRate) p.sampleRate = audioCtx().sampleRate;
      const tr = getTrack(p, p.activeTrackId);
      if (where === 'track' && tr.clips.length) { const t = newTrack(p.tracks.length, a.name); t.clips.push(newClip(id, d, at)); p.tracks.push(t); p.activeTrackId = t.id; }
      else if (!tr.clips.length) tr.clips.push(newClip(id, d, where === 'track' ? at : 0));
      else insertAt(tr, at, { duration: d, clips: [newClip(id, d, 0)] });
    });
    if (where === 'track' && app.project.tracks.length > 1) app.setView('multi');
    toast(`أُدرج «${a.name}» (${d.toFixed(1)} ث)`);
  }
  app.useLibrarySound = useSound;

  A.library = async (section = 'sound') => {
    let sec = section; let playing = null;
    const list = h('div', { class: 'lib-list' });
    const stopPlay = () => { if (playing) { app.player.stop(); playing = null; } };
    const btn = (ic, label, onclick, cls = '') => h('button', { type: 'button', class: 'lib-b ' + cls, title: label, 'aria-label': label, onclick }, icon(ic, 18), h('span', {}, label));
    const empty = (t) => h('p', { class: 'note lib-empty' }, t);
    const render = () => {
      list.replaceChildren();
      if (sec === 'sound' || sec === 'ir') {
        const items = listAssets(sec);
        list.append(h('div', { class: 'lib-add' }, btn('Plus', sec === 'ir' ? 'إضافة غرفة' : 'إضافة أصوات', async () => { await addFiles(await pickFiles(), sec); }, 'primary'),
          sec === 'sound' ? btn('Save', 'حفظ المحدد', async () => { await A.libSaveSel(); }) : null));
        if (!items.length) list.append(empty(sec === 'ir' ? 'لا توجد غرف بعد. أضف ملف «استجابة نبضية» (IR) مسجّلًا في مكان حقيقي، فيظهر اسمه في أداة «تردد».' : 'لا توجد أصوات بعد. أضف ملفات (مؤثرات، لوبات، فواصل، أذان، تسجيلات…) أو احفظ جزءًا محددًا من مشروعك.'));
        for (const a of items) {
          const on = playing === a.id;
          list.append(h('div', { class: 'lib-row', 'data-asset': a.name },
            h('button', { type: 'button', class: 'lib-play' + (on ? ' on' : ''), 'aria-label': on ? 'إيقاف' : 'استماع', onclick: () => { if (on) { stopPlay(); } else { playing = a.id; app.player.playPCM(a.pcm, () => { playing = null; render(); }); } render(); } }, icon(on ? 'Pause' : 'Play', 18)),
            h('div', { class: 'lib-nm' }, h('b', {}, a.name), h('small', {}, (a.duration || pcmDuration(a.pcm)).toFixed(1) + ' ث')),
            sec === 'sound' ? btn('Plus', 'عند المؤشر', () => { stopPlay(); useSound(a, 'cursor'); }) : null,
            sec === 'sound' ? btn('Layers', 'مسار جديد', () => { stopPlay(); useSound(a, 'track'); }) : null,
            btn('Pencil', 'تسمية', async () => { const n = await promptDlg('الاسم', a.name); if (n) renameAsset(a.id, n); }),
            btn('Trash2', 'حذف', async () => { if (await confirmDlg('حذف من المكتبة', `حذف «${a.name}» من مكتبتك؟ لن يتأثر أي مشروع استخدمه.`, 'احذف')) { if (playing === a.id) stopPlay(); deleteAsset(a.id); } }, 'danger')));
        }
      } else if (sec === 'preset') {
        const items = listAssets('preset');
        if (!items.length) list.append(empty('لا توجد قوالب بعد. افتح أي مؤثر (معادل، ضاغط، صدى، تردد…) واضغط «حفظ كقالب» بعد ضبطه.'));
        for (const a of items) list.append(h('div', { class: 'lib-row', 'data-asset': a.name },
          h('div', { class: 'lib-nm' }, h('b', {}, a.name), h('small', {}, FX_NAMES[a.fx] || a.fx)),
          btn('Pencil', 'تسمية', async () => { const n = await promptDlg('الاسم', a.name); if (n) renameAsset(a.id, n); }),
          btn('Trash2', 'حذف', async () => { if (await confirmDlg('حذف القالب', `حذف «${a.name}»؟`, 'احذف')) deleteAsset(a.id); }, 'danger')));
      } else {
        list.append(empty('أخفِ الإعدادات الجاهزة التي لا تستعملها فلا تظهر في الأدوات، وأرجعها متى شئت.'));
        for (const b of BUILTINS) {
          const hid = isHidden(b.key);
          list.append(h('div', { class: 'lib-row' + (hid ? ' off' : ''), 'data-builtin': b.key },
            h('div', { class: 'lib-nm' }, h('b', {}, b.label), h('small', {}, FX_NAMES[b.fx])),
            btn(hid ? 'EyeOff' : 'Eye', hid ? 'إظهار' : 'إخفاء', () => setHidden(b.key, !hid))));
        }
      }
    };
    const seg = segmented([{ value: 'sound', label: 'أصواتي' }, { value: 'ir', label: 'غرف التردد' }, { value: 'preset', label: 'قوالبي' }, { value: 'builtin', label: 'الجاهزة' }], sec, (v) => { sec = v; stopPlay(); render(); });
    const off = onAssets(render); render();
    await dialog({ title: 'مكتبتي', wide: true, body: h('div', { class: 'lib' }, seg, list), actions: [{ label: 'إغلاق', value: true }] });
    off(); stopPlay();
  };

  app.tab('library', 'المكتبة', () => [
    { icon: 'Library', label: 'مكتبتي', id: 'library' },
    { icon: 'FilePlus', label: 'إضافة أصوات', id: 'libAddSound' },
    { icon: 'Save', label: 'حفظ المحدد', id: 'libSaveSel' },
    { icon: 'Church', label: 'إضافة غرفة', id: 'libAddIR' },
  ], 75);
}
