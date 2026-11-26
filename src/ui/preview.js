// "Live preview" bar for tool dialogs: loops the selection (≤15 s) through the tool and
// re-renders automatically whenever any control in the dialog changes.
import { h } from './dom.js';
import { icon } from './icons.js';

const clonePCM = (p) => ({ sampleRate: p.sampleRate, channels: p.channels.map((c) => c.slice()) });

export function livePreview(app, { range, process, maxSec = 15, autoStart = true, source }) {
  let on = false, base = null, timer = null, gen = 0;
  const label = h('span', {}, 'معاينة');
  const btn = h('button', { type: 'button', class: 'btn preview-btn', 'data-testid': 'preview' }, icon('Play', 18), label);
  const status = h('span', { class: 'note' }, 'استمع للنتيجة قبل الاعتماد؛ تتحدث تلقائيًا مع كل تغيير.');
  const ui = () => { btn.replaceChildren(icon(on ? 'Pause' : 'Play', 18), h('span', {}, on ? 'إيقاف المعاينة' : 'معاينة')); btn.classList.toggle('on', on); };
  async function run() {
    if (!on) return; const my = ++gen;
    status.textContent = 'جارٍ تجهيز المعاينة…';
    try {
      if (!base) base = source ? await source() : app.renderRange(range.a, Math.min(range.b, range.a + maxSec));
      const out = await process(clonePCM(base));
      if (!on || my !== gen || !out) return;
      const pos = app.player.playing && app.player.preview ? app.player.position() : 0;
      const dur = out.channels[0].length / out.sampleRate;
      app.player.playPCM(out, null, { loop: true, offset: dur > 0 ? pos % dur : 0 });
      status.textContent = `تُعزف المعاينة بتكرار (${dur.toFixed(1)} ث)${range.b - range.a > maxSec ? ' — أول ' + maxSec + ' ثانية من النطاق' : ''}`;
    } catch (e) { status.textContent = 'تعذّرت المعاينة: ' + e.message; }
  }
  btn.onclick = () => { on = !on; ui(); if (on) run(); else { gen++; app.player.stop(); status.textContent = 'المعاينة متوقفة.'; } };
  const el = h('div', { class: 'preview-bar' }, btn, status);
  el.attach = (container) => {
    const kick = () => { if (!on) return; clearTimeout(timer); timer = setTimeout(run, 280); };
    for (const ev of ['input', 'click', 'pointerup', 'keyup']) container.addEventListener(ev, (e) => { if (e.target.closest('.preview-btn')) return; kick(); });
    if (autoStart) { on = true; ui(); run(); }
  };
  el.stop = () => { on = false; gen++; clearTimeout(timer); app.player.stop(); };
  ui();
  return el;
}
