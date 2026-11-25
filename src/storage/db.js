// Minimal IndexedDB wrapper: projects, sources (PCM), settings.
const DB_NAME = 'sada-db', VER = 1;
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VER);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ['projects', 'sources', 'settings']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out && 'result' in out ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}
export const dbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const dbPut = (store, key, val) => tx(store, 'readwrite', (s) => { s.put(val, key); });
export const dbDel = (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); });
export const dbKeys = (store) => tx(store, 'readonly', (s) => s.getAllKeys());
export const dbAll = (store) => tx(store, 'readonly', (s) => s.getAll());

// shared inbox for sending audio to the other personal apps on the same origin (e.g. the video program)
const INBOX = 'shared-media-inbox';
export function sendToInbox(item) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(INBOX, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('items')) r.result.createObjectStore('items', { keyPath: 'id' }); };
    r.onsuccess = () => { const t = r.result.transaction('items', 'readwrite'); t.objectStore('items').put(item); t.oncomplete = () => { r.result.close(); try { new BroadcastChannel('shared-media-inbox').postMessage({ type: 'new-item', id: item.id }); } catch {} res(); }; t.onerror = () => rej(t.error); };
    r.onerror = () => rej(r.error);
  });
}
