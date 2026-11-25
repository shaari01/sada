import { renderProject } from '../audio/engine.js';
import { encodeWAV } from '../export/wav.js';
import { runDSP } from '../dsp/client.js';
import { dialog, h, segmented, progressDlg, download, toast } from '../ui/dom.js';
import { projectDuration } from '../core/project.js';
import { peakOf } from '../core/pcm.js';

export const FORMATS = [
  { value: 'mp3', label: 'MP3', mime: 'audio/mpeg' },
  { value: 'wav', label: 'WAV', mime: 'audio/wav' },
];
export function registerFormat(f) { if (!FORMATS.find((x) => x.value === f.value)) FORMATS.push(f); }
const encoders = {
  wav: async (pcm) => encodeWAV(pcm, 16),
  mp3: async (pcm, q, onP) => runDSP('mp3', { pcm, kbps: q.kbps || 192 }, { onProgress: onP }),
};
export function registerEncoder(name, fn) { encoders[name] = fn; }

export async function encode(fmt, pcm, q = {}, onP) {
  // safety limiter: avoid hard clipping if the mix exceeds 0 dBFS
  const pk = peakOf(pcm); if (pk > 1) for (const ch of pcm.channels) for (let i = 0; i < ch.length; i++) ch[i] /= pk * 1.0001;
  return encoders[fmt](pcm, q, onP);
}
export const safeName = (s) => (s || 'صدى').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

export function setupExport(app) {
  const { state } = app; const A = app.actions;
  A.export = async (opts = {}) => {
    const p = state.project; const D = projectDuration(p);
    if (D <= 0) { toast('لا يوجد صوت للتصدير'); return; }
    let fmt = opts.format || localStorage.getItem('sada.fmt') || 'mp3', range = 'all', kbps = 192;
    const hasSel = state.selection && state.selection[1] - state.selection[0] > 0.01;
    const name = h('input', { class: 'inp', value: safeName(p.name), dir: 'auto' });
    const body = h('div', {},
      h('p', {}, 'الصيغة'), segmented(FORMATS.map((f) => ({ value: f.value, label: f.label })), fmt, (v) => (fmt = v)),
      h('p', {}, 'النطاق'), segmented([{ value: 'all', label: 'المشروع كاملًا' }, ...(hasSel ? [{ value: 'sel', label: 'الجزء المحدد فقط' }] : [])], range, (v) => (range = v)),
      h('p', {}, 'الجودة (MP3 / M4A / OGG)'), segmented([{ value: 128, label: '128' }, { value: 192, label: '192' }, { value: 320, label: '320' }], kbps, (v) => (kbps = v)),
      h('p', {}, 'اسم الملف'), name,
    );
    const ok = opts.auto ? true : await dialog({ title: 'تصدير الصوت', body, actions: [{ label: 'إلغاء', value: false }, { label: 'صدّر', value: true, primary: true }] });
    if (!ok) return;
    try { localStorage.setItem('sada.fmt', fmt); } catch {}
    const [t0, t1] = range === 'sel' ? state.selection : [0, D];
    const pg = progressDlg('تصدير');
    try {
      pg.set(null, 'جارٍ مزج المسارات…');
      const pcm = await renderProject(p, app.getSource, { t0, t1, trackFilter: opts.trackFilter });
      pg.set(0, 'جارٍ الترميز…');
      const bytes = await encode(fmt, pcm, { kbps }, (x) => pg.set(x));
      const f = FORMATS.find((x) => x.value === fmt);
      const file = `${safeName(opts.name || name.value)}.${f.ext || fmt}`;
      if (opts.returnBytes) return { bytes, file, mime: f.mime };
      download(bytes, file, f.mime);
      toast('تم التصدير: ' + file, 'info', 4000);
      return { bytes, file };
    } catch (e) { console.error(e); toast('فشل التصدير: ' + e.message, 'error', 6000); }
    finally { pg.close(); }
  };
  app.tab('export', 'تصدير', () => [
    { icon: 'Download', label: 'تصدير', id: 'export' },
  ], 90);
}
