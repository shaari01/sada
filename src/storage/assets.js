// The user's own library: sound clips, reverb rooms (impulse responses) and effect presets.
// Built-in presets can be hidden (and restored) so only what the user wants stays visible.
import { dbAll, dbPut, dbDel, dbGet } from './db.js';
import { uid } from '../core/ids.js';

export const KINDS = { sound: 'أصواتي', ir: 'غرف التردد', preset: 'قوالبي' };
const items = new Map(); let hidden = new Set(); let loaded = null; const subs = new Set();
const notify = () => subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
export const onAssets = (f) => (subs.add(f), () => subs.delete(f));

export function loadAssets() {
  if (!loaded) loaded = (async () => {
    try { for (const a of (await dbAll('assets')) || []) items.set(a.id, a); } catch (e) { console.warn('assets', e); }
    try { hidden = new Set((await dbGet('settings', 'hiddenBuiltins')) || []); } catch {}
    notify();
  })();
  return loaded;
}
export const listAssets = (kind, fx) => [...items.values()].filter((a) => a.kind === kind && (!fx || a.fx === fx)).sort((a, b) => a.created - b.created);
export const getAsset = (id) => items.get(id);
export async function addAsset(a) {
  const it = { id: uid('ast'), created: Date.now(), ...a };
  items.set(it.id, it); notify();
  try { await dbPut('assets', it.id, it); } catch (e) { console.warn(e); }
  return it;
}
export async function renameAsset(id, name) { const a = items.get(id); if (!a) return; a.name = name; notify(); try { await dbPut('assets', id, a); } catch {} }
export async function deleteAsset(id) { items.delete(id); notify(); try { await dbDel('assets', id); } catch {} }

// built-in presets: key is "<fx>:<name>", e.g. "reverb:mosque"
export const isHidden = (key) => hidden.has(key);
export async function setHidden(key, h) { h ? hidden.add(key) : hidden.delete(key); notify(); try { await dbPut('settings', 'hiddenBuiltins', [...hidden]); } catch {} }
