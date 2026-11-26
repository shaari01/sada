// المرحلة 6: المؤثرات (مع معاينة)، والتسجيل، وفصل الأغنية، وبقية صيغ التصدير
import { processWithChain, audioCtx, decodeFile } from '../audio/engine.js';
import { chainFor, REVERBS, EQ_PRESETS, EQ_BANDS } from '../audio/effects.js';
import { runDSP } from '../dsp/client.js';
import { peakOf, gainPCM, reversePCM, pcmDuration } from '../core/pcm.js';
import { newTrack, newClip, getTrack, trackEnd, projectDuration } from '../core/project.js';
import { uid } from '../core/ids.js';
import { dialog, h, slider, segmented, toast, progressDlg, download, fmtTime, confirmDlg } from '../ui/dom.js';
import { registerFormat, registerEncoder, encode, safeName, FORMATS } from './export.js';
import { codecSupported, encodeOGG, encodeM4A } from '../export/codecs.js';
import { encodeWAV } from '../export/wav.js';
import { sendToInbox } from '../storage/db.js';
import { bakeFade } from './phase3-level.js';

export function normalizeGain(pcm, targetDb = -1) { const pk = peakOf(pcm); return pk > 0 ? Math.pow(10, targetDb / 20) / pk : 1; }

export function setup(app) {
  const { state } = app; const A = app.actions;
  const tail = (spec) => (spec.type === 'reverb' ? 0 : 0);
  async function runEffect(spec, pcm, onP) {
    switch (spec.type) {
      case 'normalize': return gainPCM(pcm, normalizeGain(pcm, spec.db));
      case 'reverse': return reversePCM(pcm);
      case 'denoise': { const ch = await runDSP('denoise', { channels: pcm.channels, sampleRate: pcm.sampleRate, strength: spec.strength }, { onProgress: onP }); return { sampleRate: pcm.sampleRate, channels: ch }; }
      case 'hum': { const ch = await runDSP('hum', { channels: pcm.channels, sampleRate: pcm.sampleRate, freq: spec.freq }); return { sampleRate: pcm.sampleRate, channels: ch }; }
      default: return processWithChain(pcm, chainFor(spec), { tail: tail(spec) });
    }
  }
  app.runEffect = runEffect;
  /** generic effect dialog with live preview of (up to) the first 10 s */
  async function effectDialog(title, note, controls, getSpec, label) {
    const r = app.range(); if (!r) return toast('افتح ملفًا أولًا');
    const info = h('p', { class: 'note' }, `يُطبّق على ${r.kind === 'selection' ? 'الجزء المحدد' : r.kind === 'clip' ? 'المقطع المحدد' : 'المسار كاملًا'} (${(r.b - r.a).toFixed(1)} ث).`);
    const preview = async () => { const pcm = app.renderRange(r.a, Math.min(r.b, r.a + 10)); const pg = progressDlg('تجهيز المعاينة'); try { app.player.playPCM(await runEffect(getSpec(), pcm)); } finally { pg.close(); } return false; };
    const ok = await dialog({ title, body: h('div', {}, note ? h('p', { class: 'note' }, note) : null, ...controls, info), actions: [{ label: 'إلغاء', value: false }, { label: '▶ معاينة', value: false, onClick: preview }, { label: 'طبّق', value: true, primary: true }] });
    app.player.stop(); if (!ok) return;
    const spec = getSpec();
    await app.processRange(label || title, (pcm, onP) => runEffect(spec, pcm, onP), { range: r, progressTitle: title });
  }
  A.amplify = () => { const s = slider({ label: 'التضخيم', min: -20, max: 20, step: 0.5, value: 6, fmt: (v) => (v > 0 ? '+' : '') + v + ' dB' }); return effectDialog('تضخيم', 'ارفع مستوى الصوت أو اخفضه. (+6 dB ≈ ضعف الارتفاع المسموع تقريبًا)', [s], () => ({ type: 'gain', db: s.get() })); };
  A.normalize = () => { const s = slider({ label: 'أعلى قمة', min: -12, max: 0, step: 0.5, value: -1, fmt: (v) => v + ' dB' }); return effectDialog('تطبيع', 'يرفع الصوت حتى تصل أعلى قمة إلى المستوى المحدد دون تشويه.', [s], () => ({ type: 'normalize', db: s.get() })); };
  A.compressor = () => {
    let pre = 'mid'; const P = { light: [-18, 2, 3], mid: [-24, 4, 6], strong: [-32, 8, 10] };
    const th = slider({ label: 'العتبة', min: -60, max: 0, step: 1, value: -24, fmt: (v) => v + ' dB' }), ra = slider({ label: 'النسبة', min: 1, max: 20, step: 0.5, value: 4, fmt: (v) => v + ':1' }), mk = slider({ label: 'تعويض المستوى', min: 0, max: 20, step: 0.5, value: 6, fmt: (v) => '+' + v + ' dB' });
    const seg = segmented([{ value: 'light', label: 'خفيف' }, { value: 'mid', label: 'متوسط' }, { value: 'strong', label: 'قوي' }], pre, (v) => { pre = v; th.set(P[v][0]); ra.set(P[v][1]); mk.set(P[v][2]); });
    return effectDialog('ضاغط (Compressor)', 'يقرّب الأصوات العالية والمنخفضة من بعضها فيصبح الصوت أوضح وأثبت.', [seg, th, ra, mk], () => ({ type: 'comp', threshold: th.get(), ratio: ra.get(), makeup: mk.get() }));
  };
  A.eq = () => {
    let pre = 'clear'; const bands = EQ_BANDS.map((f) => slider({ label: f >= 1000 ? f / 1000 + ' ك.هرتز' : f + ' هرتز', min: -12, max: 12, step: 0.5, value: 0, fmt: (v) => (v > 0 ? '+' : '') + v }));
    const custom = h('div', { hidden: true }, ...bands);
    const seg = segmented([...Object.entries(EQ_PRESETS).map(([k, v]) => ({ value: k, label: v.label })), { value: 'custom', label: 'يدوي' }], pre, (v) => { pre = v; custom.hidden = v !== 'custom'; });
    return effectDialog('معادل الصوت', null, [seg, custom], () => ({ type: 'eq', preset: pre, gains: bands.map((b) => b.get()) }), 'معادل الصوت');
  };
  A.echo = () => { const t = slider({ label: 'زمن الصدى', min: 0.05, max: 1.5, step: 0.01, value: 0.35, fmt: (v) => v.toFixed(2) + ' ث' }), fb = slider({ label: 'التكرار', min: 0, max: 0.85, step: 0.01, value: 0.4, fmt: (v) => Math.round(v * 100) + '%' }), mx = slider({ label: 'قوة الصدى', min: 0, max: 1, step: 0.01, value: 0.4, fmt: (v) => Math.round(v * 100) + '%' }); return effectDialog('صدى (Echo)', 'تكرار الصوت بعد زمن محدد.', [t, fb, mx], () => ({ type: 'echo', time: t.get(), feedback: fb.get(), mix: mx.get() })); };
  A.reverb = () => { let pre = 'hall'; const mx = slider({ label: 'قوة التردد', min: 0, max: 1, step: 0.01, value: 0.35, fmt: (v) => Math.round(v * 100) + '%' }); const seg = segmented(Object.entries(REVERBS).map(([k, v]) => ({ value: k, label: v.label })), pre, (v) => (pre = v)); return effectDialog('تردد (Reverb)', 'يُشعر بأن الصوت في مكان: غرفة، أو قاعة، أو مسجد، أو فضاء.', [seg, mx], () => ({ type: 'reverb', preset: pre, mix: mx.get() })); };
  A.denoise = () => { const s = slider({ label: 'القوة', min: 0.2, max: 2, step: 0.1, value: 1, fmt: (v) => v.toFixed(1) }); return effectDialog('إزالة الضوضاء', 'يتعرف على الضوضاء الثابتة (مروحة، هسهسة) من أهدأ أجزاء الصوت ويخفضها. ارفع القوة بحذر حتى لا يصبح الصوت «معدنيًا».', [s], () => ({ type: 'denoise', strength: s.get() })); };
  A.hum = () => { let f = 'auto'; const seg = segmented([{ value: 'auto', label: 'تلقائي' }, { value: 60, label: '60 هرتز (السعودية)' }, { value: 50, label: '50 هرتز' }], f, (v) => (f = v)); return effectDialog('إزالة الطنين', 'يزيل طنين الكهرباء وتوافقياته.', [seg], () => ({ type: 'hum', freq: f })); };
  A.reverse = async () => { const r = app.range(); if (!r) return; await app.processRange('عكس', (pcm) => reversePCM(pcm), { range: r }); };

  // ---------- recording ----------
  A.record = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return toast('هذا المتصفح لا يدعم التسجيل', 'error');
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); } catch { return toast('لم يُسمح باستخدام الميكروفون. اسمح به من إعدادات الموقع في المتصفح.', 'error', 6000); }
    const ctx = audioCtx(); const from = state.cursor; const withMusic = projectDuration(app.project) > 0;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const timer = h('b', { style: { fontSize: '28px', direction: 'ltr', display: 'inline-block' } }, '0:00');
    let recStart = 0, playStart = 0, iv;
    const done = new Promise((res) => (rec.onstop = res));
    rec.onstart = () => { recStart = ctx.currentTime; if (withMusic) { app.player.play(from); playStart = app.player.startCtx; } const t0 = performance.now(); iv = setInterval(() => (timer.textContent = fmtTime((performance.now() - t0) / 1000, false)), 250); };
    rec.start(250);
    const r = await dialog({ title: 'تسجيل', body: h('div', { style: { textAlign: 'center' } }, h('p', {}, h('span', { class: 'rec-dot' }), ' جارٍ التسجيل… ', timer), h('p', { class: 'note' }, withMusic ? 'تُعزف المسارات الأخرى الآن، فغنِّ أو تكلم فوقها. استخدم سماعات حتى لا تُسجَّل الموسيقى مع صوتك.' : 'تكلم أو غنِّ الآن.')), actions: [{ label: 'إلغاء', value: false }, { label: '⏹ إيقاف وحفظ', value: true, primary: true }] });
    clearInterval(iv); rec.stop(); app.player.stop(); stream.getTracks().forEach((t) => t.stop()); await done;
    if (!r || !chunks.length) return;
    try {
      const pcm = await decodeFile(new Blob(chunks, { type: rec.mimeType }));
      // align with the music: drop audio captured before playback started, plus the output/input latency
      const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      const trimSec = withMusic ? Math.max(0, playStart - recStart + lat) : 0;
      const trim = Math.min(pcm.channels[0].length - 1, Math.round(trimSec * pcm.sampleRate));
      const out = { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice(trim)) };
      const id = app.addSource(uid('src'), out, { name: 'تسجيل' }); const d = pcmDuration(out);
      app.commit('تسجيل', (p) => { const empty = p.tracks.length === 1 && !p.tracks[0].clips.length; const t = empty ? p.tracks[0] : newTrack(p.tracks.length, 'تسجيل ' + p.tracks.length); if (!empty) p.tracks.push(t); t.clips.push(newClip(id, d, withMusic ? from : (empty ? 0 : from))); p.activeTrackId = t.id; if (!p.sampleRate) p.sampleRate = ctx.sampleRate; });
      if (app.project.tracks.length > 1) app.setView('multi');
      toast(`سُجّل ${d.toFixed(1)} ث في مسار جديد`);
    } catch (e) { toast('تعذّر حفظ التسجيل: ' + e.message, 'error'); }
  };

  // ---------- song separation ----------
  A.separate = async () => {
    const tr = app.track; const end = trackEnd(tr); if (!end) return toast('المسار فارغ');
    const mobile = /Android|Mobi/i.test(navigator.userAgent);
    const body = h('div', {},
      h('p', {}, 'يفصل المسار النشط إلى أربعة مسارات: الصوت البشري، والطبول، والباص، والبقية. ويُكتم المسار الأصلي.'),
      h('p', { class: 'note' }, '⚠️ هذا فصل «تقريبي» بطرق المعالجة الكلاسيكية (فصل الإيقاعي عن اللحني، ومركز الاستريو)، يعمل بلا إنترنت. يعمل جيدًا في الأغاني التي صوت المغني فيها في المنتصف، لكنه أقل نقاءً من الذكاء الاصطناعي.'),
      h('p', { class: 'note' }, 'للحصول على فصل احترافي: استخدم Demucs على اللابتوب (الطريقة في ملف DEMUCS.md في المستودع)، ثم «استيراد مسارات مفصولة».'),
      mobile && end > 240 ? h('p', { style: { color: 'var(--danger)' } }, 'الأغنية طويلة على الجوال: قد يستغرق دقائق أو يتوقف لنفاد الذاكرة. يُفضّل تحديد جزء أو استخدام اللابتوب.') : null);
    if (!(await dialog({ title: 'فصل الأغنية', body, actions: [{ label: 'إلغاء', value: false }, { label: 'افصل', value: true, primary: true }] }))) return;
    const r = app.range(); const pcm = app.renderRange(r.a, r.b);
    const pg = progressDlg('فصل الأغنية'); let stems;
    try { stems = await runDSP('hpss', { channels: pcm.channels, sampleRate: pcm.sampleRate }, { onProgress: (p) => pg.set(p, `جارٍ الفصل… ${Math.round(p * 100)}%`), transfer: pcm.channels.map((c) => c.buffer) }); } catch (e) { pg.close(); return toast('فشل الفصل: ' + e.message, 'error'); }
    pg.close();
    const names = { vocals: 'الصوت البشري', drums: 'الطبول', bass: 'الباص', other: 'البقية' };
    const ids = {}; for (const k of Object.keys(names)) ids[k] = app.addSource(uid('src'), { sampleRate: pcm.sampleRate, channels: stems[k] }, { name: names[k] });
    const d = r.b - r.a, tid = tr.id;
    app.commit('فصل الأغنية', (p) => { getTrack(p, tid).mute = true; for (const k of Object.keys(names)) { const t = newTrack(p.tracks.length, names[k]); t.clips.push(newClip(ids[k], d, r.a)); p.tracks.push(t); } });
    app.setView('multi'); toast('فُصلت الأغنية إلى 4 مسارات. اكتم ما لا تريده أو غيّر مستواه.', 'info', 5000);
  };
  A.karaoke = async () => {
    const r = app.range(); if (!r) return;
    if (!(await confirmDlg('إزالة صوت المغني (سريع)', 'يحذف ما في منتصف الاستريو (غالبًا صوت المغني) بطرح القناتين. سريع جدًا، لكنه يحذف الباص والطبول المركزية أيضًا ويجعل الصوت أحاديًا.', 'طبّق'))) return;
    await app.processRange('إزالة الصوت (كاريوكي)', async (pcm) => { const [L, R] = pcm.channels; const s = new Float32Array(L.length); for (let i = 0; i < s.length; i++) s[i] = (L[i] - R[i]) * 0.7; return { sampleRate: pcm.sampleRate, channels: [s, s.slice()] }; }, { range: r });
  };
  A.importStems = () => { app._importNewTrack = true; app.setView('multi'); toast('اختر ملفات المسارات المفصولة (يمكن اختيار عدة ملفات معًا)'); document.getElementById('fileInput').click(); };

  // ---------- more export formats, ringtone, send to video ----------
  (async () => {
    if (await codecSupported('mp4a.40.2', 48000)) { registerFormat({ value: 'm4a', label: 'M4A', mime: 'audio/mp4' }); registerEncoder('m4a', (pcm, q) => encodeM4A(pcm, (q.kbps || 192) * 1000)); }
    if (await codecSupported('opus', 48000)) { registerFormat({ value: 'ogg', label: 'OGG', mime: 'audio/ogg' }); registerEncoder('ogg', (pcm, q) => encodeOGG(pcm, Math.min(256, q.kbps || 160) * 1000)); }
  })();
  A.ringtone = async () => {
    const s = state.selection; const start = s && s[1] > s[0] ? s[0] : state.cursor;
    const len = slider({ label: 'الطول', min: 5, max: 40, step: 1, value: 30, fmt: (v) => v + ' ث' });
    let fmt = FORMATS.find((f) => f.value === 'm4a') ? 'm4a' : 'mp3';
    const ok = await dialog({ title: 'نغمة رنين', body: h('div', {}, h('p', {}, `تبدأ من ${fmtTime(start)} (ضع المؤشر عند المذهب مثلًا).`), len, h('p', {}, 'الصيغة'), segmented(FORMATS.map((f) => ({ value: f.value, label: f.label })), fmt, (v) => (fmt = v)), h('p', { class: 'note' }, 'يُضاف تلاشٍ ناعم في البداية والنهاية. أندرويد يقبل MP3 وM4A وOGG كنغمات.')), actions: [{ label: 'إلغاء', value: false }, { label: 'صدّر النغمة', value: true, primary: true }] });
    if (!ok) return;
    const end = Math.min(projectDuration(app.project), start + len.get()); if (end - start < 1) return toast('لا يوجد صوت كافٍ بعد المؤشر');
    const pg = progressDlg('نغمة رنين');
    try {
      const pcm = await app.renderMixdown({ t0: start, t1: end }); const sr = pcm.sampleRate;
      const fi = Math.round(0.4 * sr), fo = Math.round(2 * sr), n = pcm.channels[0].length;
      for (const ch of pcm.channels) { for (let i = 0; i < Math.min(fi, n); i++) ch[i] *= i / fi; for (let i = 0; i < Math.min(fo, n); i++) ch[n - 1 - i] *= i / fo; }
      const bytes = await encode(fmt, pcm, { kbps: 192 }); const f = FORMATS.find((x) => x.value === fmt);
      download(bytes, `نغمة - ${safeName(app.project.name)}.${fmt}`, f.mime); toast('صُدّرت النغمة');
    } catch (e) { toast('فشل: ' + e.message, 'error'); } finally { pg.close(); }
  };
  A.sendVideo = async () => {
    if (!projectDuration(app.project)) return toast('لا يوجد صوت');
    const pg = progressDlg('إرسال إلى برنامج الفيديو');
    try {
      const pcm = await app.renderMixdown(); const blob = new Blob([encodeWAV(pcm)], { type: 'audio/wav' });
      await sendToInbox({ id: uid('aud'), name: `${safeName(app.project.name)}.wav`, type: 'audio', mime: 'audio/wav', blob, duration: pcmDuration(pcm), created: Date.now(), from: 'sada' });
      toast('أُرسل الصوت. افتح برنامج الفيديو على الجهاز نفسه تجده في «الوارد من البرامج الأخرى».', 'info', 6000);
    } catch (e) { toast('تعذّر الإرسال: ' + e.message, 'error'); } finally { pg.close(); }
  };
  A.share = async () => {
    const out = await app.actions.export({ returnBytes: true, format: 'mp3', auto: true }); if (!out) return;
    const file = new File([out.bytes], out.file, { type: out.mime });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: app.project.name }); } catch {} } else { download(out.bytes, out.file, out.mime); toast('المشاركة غير مدعومة هنا، فنُزّل الملف بدلًا منها'); }
  };

  app.tab('fx', 'المؤثرات', () => [
    { icon: 'Volume2', label: 'تضخيم', id: 'amplify' },
    { icon: 'BarChart3', label: 'تطبيع', id: 'normalize' },
    { icon: 'Shrink', label: 'ضاغط', id: 'compressor' },
    { icon: 'SlidersHorizontal', label: 'معادل الصوت', id: 'eq' },
    { icon: 'Repeat', label: 'صدى', id: 'echo' },
    { icon: 'Church', label: 'تردد', id: 'reverb' },
    { icon: 'Wind', label: 'إزالة الضوضاء', id: 'denoise' },
    { icon: 'Zap', label: 'إزالة الطنين', id: 'hum' },
    { icon: 'FlipHorizontal2', label: 'عكس', id: 'reverse' },
  ], 60);
  app.tab('rec', 'تسجيل وفصل', () => [
    { icon: 'Mic', label: 'تسجيل', id: 'record' },
    { icon: 'Combine', label: 'فصل الأغنية', id: 'separate' },
    { icon: 'Ear', label: 'إزالة صوت المغني', id: 'karaoke' },
    { icon: 'FilePlus', label: 'استيراد مسارات مفصولة', id: 'importStems' },
  ], 70);
  const prevExport = app.tabTools.get('export');
  app.tabTools.set('export', () => [...prevExport(), { icon: 'Bell', label: 'نغمة رنين', id: 'ringtone' }, { icon: 'Send', label: 'إلى برنامج الفيديو', id: 'sendVideo' }, { icon: 'Share2', label: 'مشاركة', id: 'share' }]);
}
