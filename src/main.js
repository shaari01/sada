import './styles.css';
import { app } from './app.js';
import { state, undo, redo, loadProject, setProject, listProjects, deleteProject, saveNow } from './storage/store.js';
import { dbGet } from './storage/db.js';
import { newProject, activeTrack, getTrack, projectDuration } from './core/project.js';
import { sortEnv } from './core/envelope.js';
import { Timeline } from './ui/timeline.js';
import { renderCards } from './ui/cards.js';
import { h, $, tbtn, fmtTime, toast, dialog, promptDlg, confirmDlg } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { setupEdit } from './tools/edit.js';
import { setupExport } from './tools/export.js';
import { audioCtx } from './audio/engine.js';

const modules = import.meta.glob('./tools/phase*.js', { eager: true });

app.actions = {};
app.view = 'single';
setupEdit(app);
setupExport(app);
for (const k of Object.keys(modules).sort()) modules[k].setup?.(app);

// ---------- timeline ----------
const tl = new Timeline($('#timeline'), {
  getProject: () => state.project, getSource: app.getSource, state, player: app.player,
  onSelect: (sel, live) => { updateSelInfo(); if (!live) renderCardsNow(); },
  onCursor: (t, seek) => { state.cursor = t; if (app.player.playing && !app.player.preview) app.actions.play(t); tl.redrawOverlay(); updateTime(); },
  onTrackActivate: (id) => { if (state.project.activeTrackId !== id) { state.project.activeTrackId = id; tl.renderHeaders(tl.headers, state.project.tracks, tl.laneH); tl.redraw(); renderToolbar(); } },
  onMarkerTap: (m) => app.actions.markerTap(m),
  onClipMove: (clipId, start, trackId) => app.actions.moveClip?.(clipId, start, trackId),
  onEnvelopeEdit: (trackId, kind, arg, live) => envelopeEdit(trackId, kind, arg, live),
});
app.timeline = tl;
tl.renderHeaders = (root, tracks, laneH) => app.renderHeaders ? app.renderHeaders(root, tracks, laneH) : (root.innerHTML = '');

let envSnapshot = null;
function envelopeEdit(trackId, kind, arg, live) {
  const p = state.project; const tr = getTrack(p, trackId); if (!tr) return;
  if (kind === 'delete') { app.commit('حذف نقطة', (pp) => { getTrack(pp, trackId).envelope.splice(arg, 1); }); return; }
  if (kind === 'commit') { if (envSnapshot) { const before = envSnapshot; envSnapshot = null; const after = structuredClone(p); state.project = before; app.commit('تعديل الغلاف', (pp) => { Object.assign(getTrack(pp, trackId), { envelope: getTrack(after, trackId).envelope }); }); } return; }
  if (live && !envSnapshot) envSnapshot = structuredClone(p);
  if (kind === 'add') {
    const pt = { t: arg.t, v: arg.v, curve: 'linear' };
    if (!live) { app.commit('نقطة غلاف', (pp) => { const t = getTrack(pp, trackId); if (!t.envelope.length) t.envelope.push({ t: 0, v: 1, curve: 'linear' }); t.envelope.push(pt); t.envelope = sortEnv(t.envelope); }); return; }
    if (!tr.envelope.length && arg.t > 0.05) tr.envelope.push({ t: 0, v: 1, curve: 'linear' });
    tr.envelope.push(pt); tr.envelope = sortEnv(tr.envelope); tl.drawBase(); return tr.envelope.indexOf(pt);
  }
  if (kind === 'move') {
    const pt = tr.envelope[arg.idx]; if (!pt) return;
    const prev = tr.envelope[arg.idx - 1], next = tr.envelope[arg.idx + 1];
    pt.t = Math.max(prev ? prev.t + 0.001 : 0, Math.min(next ? next.t - 0.001 : 1e9, arg.t)); pt.v = Math.round(arg.v * 100) / 100;
    tl.drawBase(); toast(`المستوى: ${Math.round(pt.v * 100)}%`, 'info', 900);
  }
}

// ---------- top bar ----------
const undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'تراجع', title: 'تراجع (Ctrl+Z)', onclick: () => { const l = undo(); if (l) toast('تراجع: ' + l); } }, icon('Undo2'), h('span', { class: 'lbl' }, 'تراجع'));
const redoBtn = h('button', { class: 'icon-btn', 'aria-label': 'إعادة', title: 'إعادة (Ctrl+Y)', onclick: () => { const l = redo(); if (l) toast('إعادة: ' + l); } }, icon('Redo2'), h('span', { class: 'lbl' }, 'إعادة'));
const projBtn = h('button', { class: 'icon-btn', 'aria-label': 'المشاريع', title: 'المشاريع', onclick: () => projectsDialog() }, icon('ListMusic'), h('span', { class: 'lbl' }, 'المشاريع'));
const installBtn = h('button', { class: 'icon-btn', hidden: true, title: 'تثبيت البرنامج', onclick: async () => { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; installBtn.hidden = true; } } }, icon('Download'), h('span', { class: 'lbl' }, 'تثبيت'));
$('#topActions').append(installBtn, undoBtn, redoBtn, projBtn);
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; installBtn.hidden = false; });
$('#projName').onclick = async () => { const n = await promptDlg('اسم المشروع', state.project.name); if (n) app.commit('تسمية المشروع', (p) => (p.name = n)); };

async function projectsDialog() {
  await saveNow();
  const list = await listProjects();
  const body = h('div', { class: 'proj-list' });
  const close = () => document.querySelector('dialog.dlg')?.querySelector('header button')?.click();
  body.append(h('button', { class: 'btn primary', onclick: async () => { close(); app.player.stop(); setProject(newProject('مشروع جديد', audioCtx().sampleRate)); toast('مشروع جديد'); } }, '+ مشروع جديد'));
  for (const it of list) body.append(h('div', { class: 'proj-item' },
    h('div', { class: 'grow', onclick: async () => { close(); app.player.stop(); await loadProject(it.id); toast('فُتح: ' + it.name); } }, h('b', {}, it.name + (it.id === state.project.id ? ' (الحالي)' : '')), h('small', {}, `${it.tracks} مسار · ${new Date(it.updated).toLocaleString('ar')}`)),
    it.id === state.project.id ? null : h('button', { class: 'icon-btn', 'aria-label': 'حذف المشروع', onclick: async (e) => { if (await confirmDlg('حذف المشروع', `حذف «${it.name}» نهائيًا؟`, 'احذف')) { await deleteProject(it.id); e.target.closest('.proj-item').remove(); } } }, icon('Trash2', 24))));
  await dialog({ title: 'المشاريع', body, actions: [{ label: 'إغلاق', value: null }] });
}

// ---------- view switch ----------
function renderViewSwitch() {
  const vs = $('#viewSwitch'); vs.innerHTML = '';
  for (const [v, label, ic] of [['single', 'واجهة المقطع', 'AudioWaveform'], ['multi', 'واجهة الدمج', 'Layers']]) vs.append(h('button', { role: 'tab', 'aria-selected': String(app.view === v), 'data-view': v, onclick: () => setView(v) }, icon(ic, 24), label));
}
function setView(v) { app.view = v; if (v === 'single') { if (tl.tool === 'move') tl.tool = 'select'; } renderViewSwitch(); tl.setMode(v); renderCardsNow(); renderToolbar(); try { localStorage.setItem('sada.view', v); } catch {} }
app.setView = setView;

// ---------- transport ----------
const timeEl = h('span', { class: 'time', 'data-testid': 'time' }, '0:00.00');
const selEl = h('span', { class: 'seltime' });
const playBtn = h('button', { class: 'icon-btn play', 'aria-label': 'تشغيل', title: 'تشغيل/إيقاف (مسافة)', onclick: () => (app.player.playing ? app.actions.pause() : app.actions.play()) }, icon('Play'));
const loopBtn = h('button', { class: 'icon-btn', 'aria-pressed': 'false', title: 'تكرار الجزء المحدد', onclick: () => { app.loop = !app.loop; loopBtn.setAttribute('aria-pressed', String(app.loop)); loopBtn.style.background = app.loop ? 'var(--accent)' : ''; } }, icon('Repeat'), h('span', { class: 'lbl' }, 'تكرار'));
$('#transport').append(
  h('button', { class: 'icon-btn', title: 'إلى البداية', 'aria-label': 'إلى البداية', onclick: () => { state.cursor = 0; tl.scrollTo(0); if (app.player.playing) app.actions.play(0); updateTime(); } }, icon('SkipBack')),
  playBtn,
  h('button', { class: 'icon-btn', title: 'تشغيل المحدد فقط', 'aria-label': 'تشغيل المحدد', 'data-action': 'playSel', onclick: () => app.actions.playSelection() }, icon('Play', 22), h('span', { class: 'lbl' }, 'المحدد')),
  loopBtn, timeEl, selEl, h('span', { class: 'sp' }),
  h('button', { class: 'icon-btn', title: 'تصغير', 'aria-label': 'تصغير', onclick: () => tl.zoom(0.6) }, icon('ZoomOut')),
  h('button', { class: 'icon-btn', title: 'ملاءمة', 'aria-label': 'ملاءمة الموجة', onclick: () => tl.fit() }, icon('Maximize2', 24)),
  h('button', { class: 'icon-btn', title: 'تكبير', 'aria-label': 'تكبير', onclick: () => tl.zoom(1.6) }, icon('ZoomIn')),
);
app.loop = false;
app.actions.play = (from = state.cursor) => { if (from >= projectDuration(state.project) - 0.01) from = 0; app.player.play(from, null, false); };
app.actions.playSelection = () => { const s = state.selection; if (!s || s[1] - s[0] < 0.01) { toast('حدّد جزءًا أولًا'); return; } app.player.play(s[0], s[1], app.loop); };
app.actions.pause = () => { const pos = app.player.position(); app.player.stop(); if (pos != null && !app.player.range) state.cursor = pos; updateTime(); tl.redrawOverlay(); };
app.player.on((pl) => {
  const pos = pl.position();
  playBtn.replaceChildren(icon(pl.playing ? 'Pause' : 'Play')); playBtn.setAttribute('aria-label', pl.playing ? 'إيقاف مؤقت' : 'تشغيل');
  if (pos != null && !pl.preview) { timeEl.textContent = fmtTime(pos); tl.ensureVisible(pos); }
  tl.redrawOverlay();
  if (!pl.playing) updateTime();
});
function updateTime() { timeEl.textContent = fmtTime(app.player.position() ?? state.cursor); }
function updateSelInfo() { const s = state.selection; selEl.textContent = s && s[1] > s[0] ? `${fmtTime(s[0])} – ${fmtTime(s[1])} (${(s[1] - s[0]).toFixed(2)} ث)` : ''; }

// ---------- tabs & toolbar ----------
// small icon + short label for each category (Samsung Video Editor style)
const TAB_ICONS = { edit: 'Scissors', speed: 'Gauge', level: 'Volume2', tracks: 'Layers', rhythm: 'Drum', fx: 'Sparkles', rec: 'Mic', library: 'Library', export: 'Download' };
let currentTab = 'edit';
function renderTabs() {
  const t = $('#tabs'); t.innerHTML = '';
  for (const tab of app.tabs) t.append(h('button', { role: 'tab', 'aria-selected': String(tab.id === currentTab), 'data-tab': tab.id, onclick: () => { currentTab = tab.id; renderTabs(); renderToolbar(); } }, icon(TAB_ICONS[tab.id] || 'Info', 18), h('span', {}, tab.label)));
}
function renderToolbar() {
  const bar = $('#toolbar'); bar.innerHTML = '';
  const tools = (app.tabTools.get(currentTab) || (() => []))();
  for (const tdef of tools) { if (tdef.when && !tdef.when()) continue; const b = tbtn(tdef.icon, tdef.label, () => app.actions[tdef.id]?.(), { id: tdef.id, pressed: tdef.pressed?.() }); if (tdef.disabled?.()) b.disabled = true; bar.append(b); }
}
app.renderToolbar = renderToolbar;

// ---------- cards & state sync ----------
function renderCardsNow() { renderCards(app, $('#cards')); }
app.onChange((kind) => {
  if (kind === 'project' || kind === 'loaded') {
    $('#projName').textContent = state.project.name;
    undoBtn.disabled = !state.undo.length; redoBtn.disabled = !state.redo.length;
    if (kind === 'loaded') { tl.layout(); setTimeout(() => tl.fit(), 30); } else tl.layout();
    renderCardsNow(); renderToolbar(); updateSelInfo();
  }
  if (kind === 'selection') { tl.redrawOverlay(); updateSelInfo(); updateTime(); renderCardsNow(); }
  if (kind === 'dirty') $('#saveState').textContent = 'غير محفوظ…';
  if (kind === 'saved') $('#saveState').textContent = 'محفوظ ✓';
});

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog')) return;
  const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
  if (c && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (c && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (c && k === 'c') app.actions.copy(); else if (c && k === 'x') app.actions.cut(); else if (c && k === 'v') app.actions.paste();
  else if (c && k === 'a') { e.preventDefault(); app.actions.selectAll(); }
  else if (k === 'delete' || k === 'backspace') app.actions.del();
  else if (k === ' ') { e.preventDefault(); app.player.playing ? app.actions.pause() : app.actions.play(); }
  else if (k === 'm') app.actions.marker();
  else if (k === '+' || k === '=') tl.zoom(1.5); else if (k === '-') tl.zoom(0.66);
});

// ---------- files: input, drag & drop, launch queue (open-with on Windows) ----------
$('#fileInput').addEventListener('change', async (e) => { const files = [...e.target.files]; e.target.value = ''; const nt = app._importNewTrack; app._importNewTrack = false; await app.importFiles(files, { newTrack: nt }); setTimeout(() => tl.fit(), 50); });
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drop-hover'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drop-hover'); });
document.addEventListener('drop', async (e) => { e.preventDefault(); document.body.classList.remove('drop-hover'); const files = [...(e.dataTransfer?.files || [])]; if (files.length) { await app.importFiles(files, { newTrack: app.view === 'multi' }); tl.fit(); } });
if ('launchQueue' in window) window.launchQueue.setConsumer(async (lp) => { const files = await Promise.all((lp.files || []).map((f) => f.getFile())); if (files.length) { await app.importFiles(files); tl.fit(); } });
window.addEventListener('pagehide', () => saveNow());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

// ---------- boot ----------
async function boot() {
  renderViewSwitch(); renderTabs();
  let v = 'single'; try { v = localStorage.getItem('sada.view') || 'single'; } catch {}
  const last = await dbGet('settings', 'lastProject').catch(() => null);
  const ok = last && (await loadProject(last).catch(() => false));
  if (!ok) setProject(newProject('مشروع جديد', 48000));
  setView(v);
  try { if (navigator.storage?.persist) navigator.storage.persist(); } catch {}
}
boot();

// ---------- service worker ----------
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const upd = registerSW({ immediate: true, onNeedRefresh() { dialog({ title: 'تحديث جديد', body: h('p', {}, 'يوجد إصدار أحدث من البرنامج. هل تريد التحديث الآن؟ (عملك محفوظ)'), actions: [{ label: 'لاحقًا', value: false }, { label: 'حدّث', value: true, primary: true }] }).then(async (r) => { if (r) { await saveNow(); upd(true); } }); }, onOfflineReady() { toast('البرنامج جاهز للعمل بلا إنترنت ✓'); } });
  });
}
