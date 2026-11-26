// "قوالبي" row inside effect dialogs: the user's own saved settings, plus "حفظ كقالب".
import { h, promptDlg, confirmDlg } from './dom.js';
import { icon } from './icons.js';
import { listAssets, addAsset, deleteAsset, onAssets } from '../storage/assets.js';

export function presetRow(fx, getSpec, setSpec) {
  const row = h('div', { class: 'preset-row', 'data-fx': fx });
  const render = () => {
    const mine = listAssets('preset', fx);
    row.replaceChildren(
      h('span', { class: 'pr-lbl' }, 'قوالبي'),
      ...mine.map((a) => h('span', { class: 'uchip' },
        h('button', { type: 'button', class: 'uchip-main', 'data-preset': a.name, onclick: () => setSpec(structuredClone(a.spec)) }, a.name),
        h('button', { type: 'button', class: 'uchip-x', 'aria-label': 'حذف القالب ' + a.name, title: 'حذف', onclick: async () => { if (await confirmDlg('حذف القالب', `حذف «${a.name}» من قوالبك؟`, 'احذف')) deleteAsset(a.id); } }, icon('X', 14)))),
      h('button', { type: 'button', class: 'uchip add', 'data-action': 'savePreset', onclick: async () => {
        const name = await promptDlg('اسم القالب', 'قالبي ' + (mine.length + 1));
        if (name) await addAsset({ kind: 'preset', fx, name, spec: structuredClone(getSpec()) });
      } }, icon('Save', 15), 'حفظ كقالب'),
    );
  };
  const off = onAssets(render); render(); row.dispose = off;
  return row;
}
