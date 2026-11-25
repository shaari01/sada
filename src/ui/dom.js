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
  return h('button', { class: 'tbtn ' + (extra.class || ''), type: 'button', title: extra.title || label, 'data-action': extra.id || null, onclick: onClick, 'aria-pressed': extra.pressed != null ? String(!!extra.pressed) : null }, icon(iconName, extra.size || 30), h('span', {}, label));
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
      h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق', onclick: () => close(null) }, icon('X', 26))),
      h('div', { class: 'dlg-body' }, content),
      h('footer', {}, ...actions.map((a) => h('button', { type: 'button', class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), 'data-value': String(a.value), onclick: async () => { if (a.onClick) { const keep = await a.onClick(d); if (keep === false) return; } close(typeof a.value === 'function' ? a.value(d) : a.value); } }, a.label))),
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
/** labelled slider row */
export function slider({ label, min, max, step = 1, value, fmt = (v) => v, onInput, id }) {
  const out = h('output', {}, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value, id, oninput: (e) => { out.textContent = fmt(+e.target.value); onInput?.(+e.target.value); } });
  const row = h('label', { class: 'slider-row' }, h('span', { class: 'lbl' }, label), inp, out);
  row.input = inp; row.get = () => +inp.value; row.set = (v) => { inp.value = v; out.textContent = fmt(+v); };
  return row;
}
export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  const render = () => { wrap.innerHTML = ''; for (const o of options) wrap.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === value), class: o.value === value ? 'on' : '', onclick: () => { value = o.value; render(); onChange?.(value); } }, o.icon ? icon(o.icon, 22) : null, o.label)); };
  render(); wrap.get = () => value; return wrap;
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
