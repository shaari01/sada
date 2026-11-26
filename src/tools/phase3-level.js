// المرحلة 3: التدرج إلى مستوى محدد، وخط الغلاف، والتلاشي، والخفض التلقائي
import { applyRamp, envValueAt, shape } from '../core/envelope.js';
import { getTrack, trackEnd } from '../core/project.js';
import { mixdownMono } from '../core/pcm.js';
import { voiceActivity, duckEnvelope } from '../core/duck.js';
import { dialog, h, slider, segmented, toast, confirmDlg } from '../ui/dom.js';
import { livePreview } from '../ui/preview.js';

const SHAPES = [{ value: 'linear', label: 'خطي' }, { value: 'smooth', label: 'ناعم' }, { value: 'fast', label: 'سريع ثم بطيء' }, { value: 'slow', label: 'بطيء ثم سريع' }];
export function bakeFade(pcm, kind, curve = 'linear') {
  const n = pcm.channels[0].length;
  for (const ch of pcm.channels) for (let i = 0; i < n; i++) { const x = i / Math.max(1, n - 1); ch[i] *= shape(curve, kind === 'in' ? x : 1 - x); }
  return pcm;
}

export function setup(app) {
  const { state } = app; const A = app.actions;
  A.ramp = async (preset) => {
    const tr = app.track; let r = app.range({ allowWhole: false });
    const durSl = slider({ label: 'المدة', min: 0.2, max: 15, step: 0.1, value: 2, fmt: (v) => v.toFixed(1) + ' ث' });
    const cur = Math.round(envValueAt(tr.envelope, r ? r.a : state.cursor) * 100);
    const from = slider({ label: 'من مستوى', min: 0, max: 150, step: 1, value: preset?.from ?? cur, fmt: (v) => v + '%' });
    const to = slider({ label: 'إلى مستوى', min: 0, max: 150, step: 1, value: preset?.to ?? 30, fmt: (v) => v + '%' });
    let shp = 'smooth'; const seg = segmented(SHAPES, shp, (v) => (shp = v));
    const chips = h('div', { class: 'chips' },
      h('button', { type: 'button', class: 'chip', onclick: () => { from.set(100); to.set(30); } }, 'انخفض 100% ← 30%'),
      h('button', { type: 'button', class: 'chip', onclick: () => { from.set(40); to.set(90); } }, 'ارتفع 40% ← 90%'),
      h('button', { type: 'button', class: 'chip', onclick: () => { from.set(100); to.set(50); } }, 'إلى النصف'),
      h('button', { type: 'button', class: 'chip', onclick: () => { from.set(30); to.set(100); } }, 'عودة إلى 100%'));
    const body = h('div', {}, h('p', { class: 'note' }, r ? `يتدرج مستوى الصوت خلال الجزء المحدد (${(r.b - r.a).toFixed(2)} ث) ثم يبقى على المستوى الجديد.` : 'يبدأ التدرج من المؤشر خلال المدة التي تختارها، ثم يبقى الصوت على المستوى الجديد.'), r ? null : durSl, from, to, chips, h('p', {}, 'شكل التدرج'), seg);
    const span = () => (r ? [r.a, r.b] : [state.cursor, state.cursor + durSl.get()]);
    const pa = Math.max(0, (r ? r.a : state.cursor) - 1.5);
    const pv = livePreview(app, { range: { a: pa, b: pa + 15 }, maxSec: 15, source: async () => app.renderRange(pa, Math.min(trackEnd(tr), pa + 15)),
      process: (pcm) => { const [a, b] = span(); const env = applyRamp(tr.envelope, a, b, from.get() / 100, to.get() / 100, shp); const sr = pcm.sampleRate; for (const ch of pcm.channels) for (let i = 0; i < ch.length; i++) ch[i] *= envValueAt(env, pa + i / sr); return pcm; } });
    body.append(pv);
    const ok = await dialog({ title: 'التدرج إلى مستوى محدد', body, onOpen: () => pv.attach(body), actions: [{ label: 'إلغاء', value: false }, { label: 'اعتماد', value: true, primary: true }] });
    pv.stop();
    if (!ok) return;
    const a = r ? r.a : state.cursor, b = r ? r.b : state.cursor + durSl.get();
    const tid = tr.id;
    app.commit(`تدرج ${from.get()}% ← ${to.get()}%`, (p) => { const t = getTrack(p, tid); t.envelope = applyRamp(t.envelope, a, b, from.get() / 100, to.get() / 100, shp); });
    toast('أُضيف التدرج إلى خط الغلاف (يمكنك تعديل نقاطه بالسحب)');
  };
  async function fade(kind) {
    const r = app.range(); if (!r) return;
    let rr = r;
    if (r.kind !== 'selection') { const d = Math.min(3, (r.b - r.a) / 2); rr = kind === 'in' ? { a: r.a, b: r.a + d, kind: 'selection' } : { a: r.b - d, b: r.b, kind: 'selection' }; }
    let shp = 'linear'; const seg = segmented(SHAPES, shp, (v) => (shp = v));
    const pv = livePreview(app, { range: rr, process: (pcm) => bakeFade(pcm, kind, shp) });
    const body = h('div', {}, h('p', { class: 'note' }, `${kind === 'in' ? 'يبدأ الصوت من الصمت ويرتفع' : 'ينخفض الصوت حتى الصمت'} خلال ${(rr.b - rr.a).toFixed(2)} ث${r.kind !== 'selection' ? ' (حدّد جزءًا لتغيير المدة)' : ''}.`), seg, pv);
    const ok = await dialog({ title: kind === 'in' ? 'تلاشٍ عند البداية (Fade In)' : 'تلاشٍ عند النهاية (Fade Out)', body, onOpen: () => pv.attach(body), actions: [{ label: 'إلغاء', value: false }, { label: 'اعتماد', value: true, primary: true }] });
    pv.stop();
    if (!ok) return;
    await app.processRange(kind === 'in' ? 'تلاشي دخول' : 'تلاشي خروج', async (pcm) => bakeFade(pcm, kind, shp), { range: rr });
  }
  A.fadeIn = () => fade('in');
  A.fadeOut = () => fade('out');
  A.envTool = () => { app.timeline.tool = app.timeline.tool === 'envelope' ? 'select' : 'envelope'; app.timeline.redraw(); app.renderToolbar(); if (app.timeline.tool === 'envelope') toast('خط الغلاف: المس لإضافة نقطة، واسحبها لأعلى وأسفل، والمس مرتين لحذفها'); };
  A.envClear = async () => { if (!app.track.envelope.length) return toast('لا يوجد غلاف في هذا المسار'); if (await confirmDlg('مسح خط الغلاف', 'إعادة مستوى هذا المسار إلى 100% ثابتًا؟')) { const tid = app.track.id; app.commit('مسح الغلاف', (p) => { getTrack(p, tid).envelope = []; }); } };
  A.duck = async () => {
    const p = app.project;
    if (p.tracks.length < 2) { toast('الخفض التلقائي يحتاج مسارين: موسيقى وصوت كلام. أضف مسارًا من تبويب «المسارات».', 'info', 5000); return; }
    let voice = p.tracks.find((t) => t.id !== p.activeTrackId)?.id || p.tracks[1].id, music = p.activeTrackId === voice ? p.tracks[0].id : p.activeTrackId;
    const opts = p.tracks.map((t) => ({ value: t.id, label: t.name }));
    const lvl = slider({ label: 'مستوى الموسيقى أثناء الكلام', min: 0, max: 90, step: 5, value: 30, fmt: (v) => v + '%' });
    const att = slider({ label: 'سرعة الانخفاض', min: 0.05, max: 1.5, step: 0.05, value: 0.3, fmt: (v) => v.toFixed(2) + ' ث' });
    const rel = slider({ label: 'سرعة العودة', min: 0.1, max: 3, step: 0.1, value: 0.8, fmt: (v) => v.toFixed(1) + ' ث' });
    const sens = slider({ label: 'الحساسية', min: 5, max: 50, step: 1, value: 15, fmt: (v) => v + '%' });
    const body = h('div', {}, h('p', {}, 'مسار الكلام (الصوت)'), segmented(opts, voice, (v) => (voice = v)), h('p', {}, 'مسار الموسيقى (الذي ينخفض)'), segmented(opts, music, (v) => (music = v)), lvl, att, rel, sens, h('p', { class: 'note' }, 'سيُستبدل خط الغلاف الحالي لمسار الموسيقى. يمكنك تعديل النقاط بعد ذلك.'));
    const ok = await dialog({ title: 'خفض الموسيقى تلقائيًا عند الكلام', body, actions: [{ label: 'إلغاء', value: false }, { label: 'طبّق', value: true, primary: true }] });
    if (!ok) return; if (voice === music) return toast('اختر مسارين مختلفين', 'error');
    const vt = getTrack(p, voice); const end = trackEnd(vt);
    const pcm = app.renderRange(0, end, vt); const segs = voiceActivity(mixdownMono(pcm), pcm.sampleRate, { sens: sens.get() / 100 });
    if (!segs.length) return toast('لم يُعثر على كلام في المسار المختار', 'error');
    const env = duckEnvelope(segs, { level: lvl.get() / 100, attack: att.get(), release: rel.get() });
    app.commit('خفض تلقائي', (pp) => { getTrack(pp, music).envelope = env; });
    toast(`خُفضت الموسيقى في ${segs.length} موضعًا`);
  };
  app.tab('level', 'المستوى', () => [
    { icon: 'TrendingDown', label: 'تدرج إلى مستوى', id: 'ramp' },
    { icon: 'Activity', label: 'خط الغلاف', id: 'envTool', pressed: () => app.timeline.tool === 'envelope' },
    { icon: 'Eraser', label: 'مسح الغلاف', id: 'envClear' },
    { icon: 'TrendingUp', label: 'تلاشي دخول', id: 'fadeIn' },
    { icon: 'TrendingDown', label: 'تلاشي خروج', id: 'fadeOut' },
    { icon: 'Headphones', label: 'خفض تلقائي', id: 'duck' },
  ], 30);
}
