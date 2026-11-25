import { h, fmtTime } from './dom.js';
import { activeTrack, sortClips, reorderClips } from '../core/project.js';
import { minMax } from './peaks.js';

export function renderCards(app, root) {
  const p = app.project; root.innerHTML = '';
  if (!p || app.view !== 'single') return;
  const tr = activeTrack(p); const clips = sortClips({ clips: tr.clips.slice() });
  if (clips.length < 2) { if (clips.length === 1) root.append(h('div', { class: 'note', style: { padding: '6px' } }, 'لإعادة ترتيب المقاطع: حدّد جزءًا ثم «تقسيم»، فتظهر هنا بطاقات تسحبها لتغيّر ترتيبها.')); return; }
  root.setAttribute('dir', 'ltr');
  const cards = clips.map((c, i) => {
    const cv = h('canvas', { width: 116, height: 34 });
    const card = h('div', { class: 'card' + (app.state.selectedClipId === c.id ? ' sel' : ''), 'data-index': i, 'data-testid': 'card' }, h('div', { class: 'ci', dir: 'rtl' }, h('b', {}, `مقطع ${i + 1}`), h('span', {}, fmtTime(c.duration, false))), cv);
    const src = app.getSource(c.sourceId);
    if (src) { const g = cv.getContext('2d'); g.fillStyle = tr.color; const sr = src.sampleRate; for (let x = 0; x < 116; x++) { const mm = minMax(src, (c.offset + (x / 116) * c.duration) * sr, (c.offset + ((x + 1) / 116) * c.duration) * sr); if (!mm) continue; const a = Math.max(-mm[0], mm[1]) * 16; g.fillRect(x, 17 - a, 1, Math.max(1, a * 2)); } }
    let start = null, moved = false, ghostIndex = i;
    card.addEventListener('pointerdown', (e) => { card.setPointerCapture(e.pointerId); start = e.clientX; moved = false; });
    card.addEventListener('pointermove', (e) => {
      if (start == null) return; if (!moved && Math.abs(e.clientX - start) < 8) return; moved = true; card.classList.add('dragging');
      card.style.transform = `translateX(${e.clientX - start}px)`;
      const rects = cards.map((x) => x.getBoundingClientRect()); ghostIndex = rects.findIndex((r) => e.clientX < r.left + r.width / 2); if (ghostIndex < 0) ghostIndex = rects.length - 1; else if (ghostIndex > i) ghostIndex--;
    });
    card.addEventListener('pointerup', () => {
      card.classList.remove('dragging'); card.style.transform = ''; const was = start; start = null; if (was == null) return;
      if (!moved) { app.state.selection = [c.start, c.start + c.duration]; app.state.selectedClipId = c.id; app.state.cursor = c.start; app.emit('selection'); renderCards(app, root); return; }
      if (ghostIndex !== i) app.commit('إعادة ترتيب', (pp) => reorderClips(activeTrack(pp), i, ghostIndex));
    });
    return card;
  });
  root.append(...cards);
}
