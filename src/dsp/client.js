let worker = null, seq = 0; const pending = new Map();
function w() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const { id, result, error, progress } = e.data; const p = pending.get(id); if (!p) return; if (progress != null) { p.onProgress?.(progress); return; } pending.delete(id); error ? p.rej(new Error(error)) : p.res(result); };
  }
  return worker;
}
export function runDSP(op, args, { onProgress, transfer = [] } = {}) {
  return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej, onProgress }); w().postMessage({ id, op, args }, transfer); });
}
