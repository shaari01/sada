// المرحلة 2: السرعة والطبقة (ثابتة وتدريجية ومنحنى)
import { runDSP } from '../dsp/client.js';
import { dialog, h, slider, segmented, toast } from '../ui/dom.js';
import { curveEditor } from '../ui/curve.js';
import { shape } from '../core/envelope.js';
import { slicePCM } from '../core/pcm.js';

export function speedPoints(mode, o) {
  if (mode === 'fixed') return null;
  if (mode === 'gradual') { const n = 16; return Array.from({ length: n + 1 }, (_, i) => ({ u: i / n, s: o.from + (o.to - o.from) * shape(o.shape, i / n) })); }
  return o.curve;
}
export async function applySpeedPitch(pcm, { speed = 1, points = null, semitones = 0 }, onProgress) {
  if (!points && Math.abs(speed - 1) < 1e-3 && !semitones) return pcm;
  const chans = await runDSP('speedPitch', { channels: pcm.channels, sampleRate: pcm.sampleRate, speed, curvePoints: points, semitones }, { onProgress, transfer: pcm.channels.map((c) => c.buffer) });
  return { sampleRate: pcm.sampleRate, channels: chans };
}

export function setup(app) {
  const A = app.actions;
  async function speedDialog(initialMode = 'fixed') {
    const r = app.range(); if (!r) { toast('افتح ملفًا أولًا'); return; }
    let mode = initialMode;
    const sp = slider({ label: 'السرعة', min: 0.5, max: 2, step: 0.01, value: 1, fmt: (v) => v.toFixed(2) + '×' });
    const pt = slider({ label: 'الطبقة', min: -12, max: 12, step: 1, value: 0, fmt: (v) => (v > 0 ? '+' : '') + v + ' نصف نغمة' });
    const from = slider({ label: 'سرعة البداية', min: 0.5, max: 2, step: 0.01, value: 1, fmt: (v) => v.toFixed(2) + '×' });
    const to = slider({ label: 'سرعة النهاية', min: 0.5, max: 2, step: 0.01, value: 1.3, fmt: (v) => v.toFixed(2) + '×' });
    let shp = 'linear';
    const shapeSeg = segmented([{ value: 'linear', label: 'خطي' }, { value: 'smooth', label: 'ناعم' }, { value: 'fast', label: 'سريع ثم بطيء' }, { value: 'slow', label: 'بطيء ثم سريع' }], shp, (v) => (shp = v));
    const curve = curveEditor({ points: [{ u: 0, s: 1 }, { u: 0.5, s: 1.3 }, { u: 1, s: 1 }], min: 0.5, max: 2, fmt: (v) => v.toFixed(2) + '×' });
    const presets = h('div', { class: 'chips' }, ...[[0.75, '0.75×'], [0.9, '0.9×'], [1.1, '1.1×'], [1.25, '1.25×'], [1.5, '1.5×']].map(([v, l]) => h('button', { type: 'button', class: 'chip', onclick: () => sp.set(v) }, l)));
    const pPresets = h('div', { class: 'chips' }, ...[-2, -1, 1, 2].map((v) => h('button', { type: 'button', class: 'chip', onclick: () => pt.set(v) }, (v > 0 ? '+' : '') + v)));
    const sections = {
      fixed: h('div', {}, h('p', { class: 'note' }, 'تغيير السرعة دون تغيير طبقة الصوت، و/أو تغيير الطبقة دون تغيير السرعة.'), sp, presets, pt, pPresets),
      pitch: h('div', {}, h('p', { class: 'note' }, 'تغيير طبقة الصوت (المقام) بأنصاف النغمات مع بقاء المدة كما هي.'), pt, pPresets),
      gradual: h('div', {}, h('p', { class: 'note' }, 'يتسارع المقطع (أو يتباطأ) تدريجيًا من سرعة البداية إلى سرعة النهاية، وتبقى طبقة الصوت كما هي.'), from, to, h('p', {}, 'شكل التدرج'), shapeSeg),
      curve: h('div', {}, h('p', { class: 'note' }, 'ارسم منحنى السرعة: المس لإضافة نقطة، واسحبها لأعلى أو أسفل، والمس مرتين لحذفها. اليسار = بداية المقطع.'), curve),
    };
    const holder = h('div', {});
    const show = () => { holder.replaceChildren(sections[mode]); };
    const modeSeg = segmented([{ value: 'fixed', label: 'ثابتة' }, { value: 'pitch', label: 'الطبقة' }, { value: 'gradual', label: 'تدريجية' }, { value: 'curve', label: 'منحنى' }], mode, (v) => { mode = v; show(); });
    show();
    const params = () => {
      const semis = mode === 'gradual' || mode === 'curve' ? 0 : pt.get();
      if (mode === 'pitch') return { speed: 1, semitones: semis };
      if (mode === 'fixed') return { speed: sp.get(), semitones: semis };
      return { speed: 1, points: speedPoints(mode, { from: from.get(), to: to.get(), shape: shp, curve: curve.get() }), semitones: 0 };
    };
    const info = h('p', { class: 'note' }, `النطاق: ${r.kind === 'selection' ? 'الجزء المحدد' : r.kind === 'clip' ? 'المقطع المحدد' : 'المسار كاملًا'} (${(r.b - r.a).toFixed(2)} ث)`);
    const res = await dialog({
      title: 'السرعة والطبقة', wide: true, body: h('div', {}, modeSeg, holder, info),
      actions: [
        { label: 'إلغاء', value: null },
        { label: 'معاينة', value: null, onClick: async (d) => { const btn = d.querySelector('[data-value="null"]:nth-of-type(2)'); const pcm = app.renderRange(r.a, Math.min(r.b, r.a + 10)); const out = await applySpeedPitch(pcm, params()); app.player.playPCM(out); return false; } },
        { label: 'طبّق', value: () => params(), primary: true },
      ],
    });
    app.player.stop();
    if (!res) return;
    const label = mode === 'pitch' ? 'تغيير الطبقة' : mode === 'fixed' ? 'تغيير السرعة' : 'سرعة تدريجية';
    await app.processRange(label, (pcm, onP) => applySpeedPitch(pcm, res, onP), { range: r, progressTitle: label });
  }
  A.speed = () => speedDialog('fixed');
  A.pitch = () => speedDialog('pitch');
  A.gradual = () => speedDialog('gradual');
  A.speedCurve = () => speedDialog('curve');
  app.applySpeedPitch = applySpeedPitch;
  app.tab('speed', 'السرعة والطبقة', () => [
    { icon: 'Gauge', label: 'السرعة', id: 'speed' },
    { icon: 'Music2', label: 'الطبقة', id: 'pitch' },
    { icon: 'TrendingUp', label: 'سرعة تدريجية', id: 'gradual' },
    { icon: 'Spline', label: 'منحنى السرعة', id: 'speedCurve' },
  ], 20);
}
export { slicePCM };
