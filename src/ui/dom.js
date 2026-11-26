import { icon } from './icons.js';
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
/** big touch button with icon + Arabic label */
export function tbtn(iconName, label, onClick, extra = {}) {
  return h('button', { class: 'tbtn ' + (extra.class || ''), type: 'button', title: extra.title || label, 'data-action': extra.id || null, onclick: onClick, 'aria-pressed': extra.pressed != null ? String(!!extra.pressed) : null }, icon(iconName, extra.size || 20), h('span', {}, label));
}
export function fmtTime(t, precise = true) {
  if (t == null || !isFinite(t)) t = 0;
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${precise ? s.toFixed(2).padStart(5, '0') : Math.floor(s).toString().padStart(2, '0')}`;
}
let toastTimer;
export function toast(msg, kind = 'info', ms = 2600) {
  let el = $('#toast'); if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.textContent = msg; el.className = 'show ' + kind; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.className = ''), ms);
}
/** Modal dialog. actions: [{label, value, primary, danger}] → resolves with value (or null on cancel). */
export function dialog({ title, body, actions = [{ label: 'تم', value: true, primary: true }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'dlg' + (wide ? ' wide' : ''), dir: 'rtl' });
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    const content = typeof body === 'string' ? h('div', { html: body }) : body;
    d.append(
      h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق', onclick: () => close(null) }, icon('X', 22))),
      h('div', { class: 'dlg-body' }, content),
      h('footer', { class: actions.length === 2 ? 'two' : '' }, ...actions.map((a) => h('button', { type: 'button', class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), 'data-value': String(a.value), onclick: async () => { if (a.onClick) { const keep = await a.onClick(d); if (keep === false) return; } close(typeof a.value === 'function' ? a.value(d) : a.value); } }, a.primary ? icon('Check', 20) : (a.value === false || a.value === null) && !a.danger ? icon('X', 20) : null, a.label))),
    );
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(d); d.showModal(); onOpen?.(d);
  });
}
export const confirmDlg = (title, text, ok = 'نعم') => dialog({ title, body: h('p', {}, text), actions: [{ label: 'إلغاء', value: false }, { label: ok, value: true, primary: true }] });
export async function promptDlg(title, value = '', presets = []) {
  const inp = h('input', { type: 'text', value, class: 'inp', dir: 'auto' });
  const body = h('div', {}, inp, presets.length ? h('div', { class: 'chips' }, ...presets.map((p) => h('button', { type: 'button', class: 'chip', onclick: () => (inp.value = p) }, p))) : null);
  const r = await dialog({ title, body, actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', value: () => inp.value.trim(), primary: true }], onOpen: () => { inp.focus(); inp.select(); } });
  return r;
}
/**
 * Touch-safe slider: the value never jumps when the finger only passes over it.
 * - vertical swipes scroll the page (touch-action: pan-y), they never change the value
 * - a tap on the track does nothing; you must grab the thumb and drag sideways
 * - − / + buttons for exact steps, and tapping the value lets you type it
 */
export function safeRange({ min, max, step = 1, value, fmt = (v) => v, onInput, onChange, label = '', compact = false }) {
  min = +min; max = +max; step = +step;
  const snapV = (v) => { const n = Math.round((v - min) / step) * step + min; return Math.min(max, Math.max(min, +n.toFixed(6))); };
  let val = snapV(+value);
  const fill = h('div', { class: 'sr-fill' }), thumb = h('div', { class: 'sr-thumb' });
  const track = h('div', { class: 'sr-track', role: 'slider', tabindex: 0, 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max }, h('div', { class: 'sr-rail' }, fill), thumb);
  const out = h('button', { type: 'button', class: 'sr-val', title: 'اضغط لكتابة القيمة' });
  const render = () => { const f = (val - min) / (max - min || 1); fill.style.width = f * 100 + '%'; thumb.style.left = `calc(${f * 100}% - 11px)`; out.textContent = fmt(val); track.setAttribute('aria-valuenow', val); track.setAttribute('aria-valuetext', fmt(val)); };
  const setV = (v, fire = true) => { const nv = snapV(v); if (nv === val) return; val = nv; render(); if (fire) onInput?.(val); };
  let drag = null;
  track.addEventListener('pointerdown', (e) => {
    const r = track.getBoundingClientRect(); const tx = r.left + ((val - min) / (max - min || 1)) * r.width;
    if (Math.abs(e.clientX - tx) > (e.pointerType === 'mouse' ? 14 : 26)) return; // not on the thumb → ignore (no accidental jumps)
    drag = { x0: e.clientX, v0: val, w: r.width, id: e.pointerId }; track.setPointerCapture(e.pointerId); track.classList.add('active');
  });
  track.addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag.id) return; setV(drag.v0 + ((e.clientX - drag.x0) / drag.w) * (max - min)); });
  const end = () => { if (!drag) return; drag = null; track.classList.remove('active'); onChange?.(val); };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end); track.addEventListener('lostpointercapture', end);
  track.addEventListener('keydown', (e) => { const k = e.key; const d = k === 'ArrowRight' || k === 'ArrowUp' ? step : k === 'ArrowLeft' || k === 'ArrowDown' ? -step : 0; if (d) { e.preventDefault(); setV(val + d); onChange?.(val); } });
  const stepBtn = (d, txt) => h('button', { type: 'button', class: 'sr-step', 'aria-label': d > 0 ? 'زيادة' : 'نقص', onclick: () => { setV(val + d); onChange?.(val); } }, txt);
  out.onclick = async () => { const v = window.prompt(label || 'القيمة', String(val)); if (v != null && v.trim() !== '' && isFinite(+v)) { setV(+v); onChange?.(val); } };
  const el = h('div', { class: 'sr' + (compact ? ' compact' : '') }, stepBtn(-step, '−'), track, stepBtn(step, '+'), out);
  render();
  el.get = () => val; el.set = (v) => { val = snapV(+v); render(); }; el.setSilently = el.set;
  return el;
}
/** labelled slider row */
export function slider({ label, min, max, step = 1, value, fmt = (v) => v, onInput, onChange, id }) {
  const sr = safeRange({ min, max, step, value, fmt, onInput, onChange, label });
  const row = h('div', { class: 'slider-row', id }, h('span', { class: 'lbl' }, label), sr);
  row.get = sr.get; row.set = sr.set;
  return row;
}
export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  const render = () => { wrap.innerHTML = ''; for (const o of options) wrap.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === value), class: o.value === value ? 'on' : '', onclick: () => { value = o.value; render(); onChange?.(value); } }, o.icon ? icon(o.icon, 18) : null, o.label)); };
  render(); wrap.get = () => value; wrap.set = (v) => { value = v; render(); }; return wrap;
}
export function progressDlg(title) {
  const bar = h('progress', { max: 1, value: 0 }); const txt = h('p', {}, 'جارٍ العمل…');
  const d = h('dialog', { class: 'dlg small', dir: 'rtl' }, h('header', {}, h('h2', {}, title)), h('div', { class: 'dlg-body' }, txt, bar));
  document.body.append(d); d.showModal(); d.addEventListener('cancel', (e) => e.preventDefault());
  return { set: (p, t) => { if (p == null) bar.removeAttribute('value'); else bar.value = p; if (t) txt.textContent = t; }, close: () => { d.close(); d.remove(); } };
}
export function download(bytes, name, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
