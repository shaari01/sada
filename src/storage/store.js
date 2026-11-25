// App state: project + sources registry + unlimited undo/redo + autosave.
import { dbGet, dbPut, dbDel, dbAll } from './db.js';
import { referencedSources } from '../core/project.js';

const listeners = new Set();
export const state = { project: null, sources: new Map(), undo: [], redo: [], dirty: false, selection: null, cursor: 0, clipboard: null, selectedClipId: null };
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export function emit(kind = 'change') { for (const fn of listeners) fn(kind); }

const snap = (p) => structuredClone(p);
/** apply a mutation to the project with undo support */
export function commit(label, mutate) {
  const before = snap(state.project);
  const r = mutate(state.project);
  state.project.updated = Date.now();
  state.undo.push({ label, project: before });
  if (state.undo.length > 500) state.undo.shift();
  state.redo = [];
  scheduleSave();
  emit('project');
  return r;
}
export function undo() { const u = state.undo.pop(); if (!u) return null; state.redo.push({ label: u.label, project: snap(state.project) }); state.project = u.project; scheduleSave(); emit('project'); return u.label; }
export function redo() { const r = state.redo.pop(); if (!r) return null; state.undo.push({ label: r.label, project: snap(state.project) }); state.project = r.project; scheduleSave(); emit('project'); return r.label; }

export function addSource(id, pcm, meta = {}) { state.sources.set(id, { ...pcm, ...meta, id }); savedSources.delete(id); return id; }
export const getSource = (id) => state.sources.get(id);

let timer = null; const savedSources = new Set();
export function scheduleSave() { state.dirty = true; clearTimeout(timer); timer = setTimeout(saveNow, 1200); emit('dirty'); }
export async function saveNow() {
  clearTimeout(timer);
  const p = state.project; if (!p) return;
  const refs = referencedSources(p);
  for (const u of state.undo) for (const id of referencedSources(u.project)) refs.add(id);
  for (const id of refs) {
    if (savedSources.has(id)) continue;
    const s = state.sources.get(id); if (!s) continue;
    await dbPut('sources', id, { sampleRate: s.sampleRate, channels: s.channels, name: s.name || '' });
    savedSources.add(id);
  }
  p.sourceIds = [...refs];
  await dbPut('projects', p.id, { project: p, updated: Date.now() });
  await dbPut('settings', 'lastProject', p.id);
  state.dirty = false; emit('saved');
}
export async function loadProject(id) {
  const rec = await dbGet('projects', id); if (!rec) return false;
  const p = rec.project;
  for (const sid of p.sourceIds || [...referencedSources(p)]) {
    if (state.sources.has(sid)) continue;
    const s = await dbGet('sources', sid); if (s) { state.sources.set(sid, { ...s, id: sid }); savedSources.add(sid); }
  }
  state.project = p; state.undo = []; state.redo = []; state.selection = null; state.cursor = 0; state.selectedClipId = null;
  emit('project'); emit('loaded');
  return true;
}
export async function listProjects() { const all = await dbAll('projects'); return all.map((r) => ({ id: r.project.id, name: r.project.name, updated: r.updated, tracks: r.project.tracks.length })).sort((a, b) => b.updated - a.updated); }
export async function deleteProject(id) {
  const rec = await dbGet('projects', id); await dbDel('projects', id);
  // garbage-collect sources not used by any other project
  const others = await dbAll('projects'); const used = new Set(); for (const r of others) for (const s of r.project.sourceIds || []) used.add(s);
  for (const s of rec?.project?.sourceIds || []) if (!used.has(s)) { await dbDel('sources', s); savedSources.delete(s); }
}
export function setProject(p) { state.project = p; state.undo = []; state.redo = []; state.selection = null; state.cursor = 0; scheduleSave(); emit('project'); emit('loaded'); }
