// المرحلة 5: الإيقاع: اكتشاف BPM، والشبكة، ومطابقة السرعة والطبقة
import { runDSP } from '../dsp/client.js';
import { keyShift, NOTE_NAMES_AR } from '../dsp/analysis.js';
import { getTrack, trackEnd, findClip, clipEnd } from '../core/project.js';
import { mixdownMono } from '../core/pcm.js';
import { dialog, h, slider, toast, progressDlg } from '../ui/dom.js';
import { livePreview } from '../ui/preview.js';

/** pick the stretch ratio closest to 1 among tempo multiples (half/double time) */
export function tempoRatio(target, source) {
  let r = target / source; while (r > 1.5) r /= 2; while (r < 0.67) r *= 2; return r;
}
const keyName = (k) => (k ? `${NOTE_NAMES_AR[k.tonic]} ${k.mode === 'major' ? 'كبير' : 'صغير'}` : '—');

export function setup(app) {
  const { state } = app; const A = app.actions;
  async function analyse(track, a = 0, b = Math.min(trackEnd(track), 90)) {
    const pcm = app.renderRange(a, b, track); const mono = mixdownMono(pcm);
    const [bpm, key] = await Promise.all([runDSP('bpm', { mono, sampleRate: pcm.sampleRate }), runDSP('key', { mono: mono.slice(), sampleRate: pcm.sampleRate })]);
    return { bpm, key };
  }
  A.detectBpm = async () => {
    const tr = app.track; if (!trackEnd(tr)) return toast('هذا المسار فارغ');
    const pg = progressDlg('اكتشاف الإيقاع والمقام'); let r;
    try { r = await analyse(tr); } finally { pg.close(); }
    if (!r.bpm) return toast('المقطع قصير جدًا لاكتشاف الإيقاع', 'error');
    const sl = slider({ label: 'الإيقاع (BPM)', min: 40, max: 220, step: 0.1, value: r.bpm.bpm, fmt: (v) => (+v).toFixed(1) });
    const chips = h('div', { class: 'chips' }, h('button', { type: 'button', class: 'chip', onclick: () => sl.set(Math.round(sl.get() / 2 * 10) / 10) }, '÷2 (نصف السرعة)'), h('button', { type: 'button', class: 'chip', onclick: () => sl.set(Math.round(sl.get() * 20) / 10) }, '×2 (ضعف السرعة)'));
    let taps = []; const tapOut = h('span', {}, '');
    const tap = h('button', { type: 'button', class: 'btn', onclick: () => { const t = performance.now(); taps = taps.filter((x) => t - x < 3000); taps.push(t); if (taps.length >= 3) { const d = (taps.at(-1) - taps[0]) / (taps.length - 1); sl.set(Math.round((60000 / d) * 10) / 10); tapOut.textContent = `(${taps.length} نقرات)`; } } }, '👆 انقر مع الإيقاع');
    const ok = await dialog({ title: 'الإيقاع والمقام', body: h('div', {}, h('p', {}, `الإيقاع المكتشف: `, h('b', { 'data-testid': 'bpm' }, r.bpm.bpm.toFixed(1)), ' نبضة/دقيقة'), h('p', {}, 'المقام المكتشف: ', h('b', {}, keyName(r.key))), sl, chips, h('p', { class: 'note' }, 'إن بدا الرقم ضعف الإيقاع الحقيقي أو نصفه فاستخدم الأزرار، أو انقر مع الإيقاع عدة مرات.'), h('div', {}, tap, ' ', tapOut)), actions: [{ label: 'إلغاء', value: false }, { label: 'اعتمد وأظهر الشبكة', value: true, primary: true }] });
    if (!ok) return;
    const tid = tr.id;
    app.commit('اكتشاف الإيقاع', (p) => { p.bpm = sl.get(); p.beatOffset = r.bpm.offset; p.key = r.key ? { tonic: r.key.tonic, mode: r.key.mode } : null; p.grid = true; p.refTrackId = tid; });
    toast(`الإيقاع ${sl.get().toFixed(1)} — الشبكة ظاهرة، والمقاطع تلتصق بها عند السحب`);
  };
  A.grid = () => { if (!app.project.bpm) return toast('اكتشف الإيقاع أولًا'); app.commit('الشبكة', (p) => (p.grid = !p.grid)); };
  A.magnet = () => { app.timeline.magnet = app.timeline.magnet === false; app.renderToolbar(); toast(app.timeline.magnet === false ? 'الالتصاق متوقف' : 'الالتصاق مفعّل'); };
  function targetRange() {
    const id = state.selectedClipId; if (id) { const f = findClip(app.project, id); if (f) { app.project.activeTrackId = f.track.id; return { a: f.clip.start, b: clipEnd(f.clip), kind: 'clip', track: f.track }; } }
    const r = app.range(); return r ? { ...r, track: app.track } : null;
  }
  A.matchTempo = async () => {
    const p = app.project; if (!p.bpm) return toast('اكتشف إيقاع الأغنية الأساسية أولًا (زر «اكتشاف الإيقاع» على مسارها)', 'info', 5000);
    const r = targetRange(); if (!r) return toast('حدّد المقطع المضاف أولًا');
    const pg = progressDlg('قياس إيقاع المقطع'); let an; try { an = await analyse(r.track, r.a, r.b); } finally { pg.close(); }
    if (!an.bpm) return toast('المقطع قصير جدًا لقياس إيقاعه', 'error');
    const ratio = tempoRatio(p.bpm, an.bpm.bpm);
    const pv = livePreview(app, { range: r, process: (pcm) => app.applySpeedPitch(pcm, { speed: ratio }) });
    const body = h('div', {}, h('p', {}, `إيقاع المقطع: ${an.bpm.bpm.toFixed(1)} — إيقاع الأغنية: ${p.bpm.toFixed(1)}`), h('p', {}, `ستتغير سرعة المقطع إلى ${ratio.toFixed(3)}× دون تغيير طبقته.`), pv);
    const ok = await dialog({ title: 'مطابقة السرعة', body, onOpen: () => pv.attach(body), actions: [{ label: 'إلغاء', value: false }, { label: 'اعتماد', value: true, primary: true }] });
    pv.stop();
    if (!ok) return;
    await app.processRange('مطابقة السرعة', (pcm, onP) => app.applySpeedPitch(pcm, { speed: ratio }, onP), { range: r, progressTitle: 'مطابقة السرعة' });
  };
  A.matchKey = async () => {
    const p = app.project; if (!p.key) return toast('اكتشف إيقاع ومقام الأغنية الأساسية أولًا', 'info', 5000);
    const r = targetRange(); if (!r) return toast('حدّد المقطع المضاف أولًا');
    const pg = progressDlg('قياس مقام المقطع'); let an; try { an = await analyse(r.track, r.a, r.b); } finally { pg.close(); }
    const semis = keyShift(an.key, p.key);
    if (!semis) return toast(`المقطع على المقام نفسه (${keyName(an.key)})`);
    const pv = livePreview(app, { range: r, process: (pcm) => app.applySpeedPitch(pcm, { speed: 1, semitones: semis }) });
    const ok = await dialog({ onOpen: (d) => pv.attach(d), title: 'مطابقة الطبقة (المقام)', body: h('div', {}, pv, h('p', {}, `مقام المقطع: ${keyName(an.key)} — مقام الأغنية: ${keyName(p.key)}`), h('p', {}, `سيُنقل المقطع ${semis > 0 ? '+' : ''}${semis} نصف نغمة دون تغيير سرعته.`), h('p', { class: 'note' }, 'كشف المقام تقريبي، خاصة في المقامات الشرقية ذات أرباع النغمات؛ استمع للمعاينة قبل الاعتماد.')), actions: [{ label: 'إلغاء', value: false }, { label: 'اعتماد', value: true, primary: true }] });
    pv.stop();
    if (!ok) return;
    await app.processRange('مطابقة الطبقة', (pcm, onP) => app.applySpeedPitch(pcm, { speed: 1, semitones: semis }, onP), { range: r, progressTitle: 'مطابقة الطبقة' });
  };
  A.snapClip = () => {
    const p = app.project; const id = state.selectedClipId; if (!p.bpm || !id) return toast('اكتشف الإيقاع وحدد مقطعًا أولًا');
    const beat = 60 / p.bpm;
    app.commit('محاذاة مع النبضة', (pp) => { const f = findClip(pp, id); const k = Math.round((f.clip.start - pp.beatOffset) / beat); f.clip.start = Math.max(0, pp.beatOffset + k * beat); });
  };
  app.tab('rhythm', 'الإيقاع', () => [
    { icon: 'Timer', label: 'اكتشاف الإيقاع', id: 'detectBpm' },
    { icon: 'Grid3x3', label: 'الشبكة', id: 'grid', pressed: () => !!app.project?.grid },
    { icon: 'Magnet', label: 'الالتصاق', id: 'magnet', pressed: () => app.timeline.magnet !== false },
    { icon: 'Gauge', label: 'مطابقة السرعة', id: 'matchTempo' },
    { icon: 'Music', label: 'مطابقة الطبقة', id: 'matchKey' },
    { icon: 'AudioLines', label: 'محاذاة مع النبضة', id: 'snapClip' },
  ], 50);
}
