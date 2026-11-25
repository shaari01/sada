import { encodeWAV } from '../../src/export/wav.js';
export function testWav(seconds = 6, sr = 44100, freqs = [220, 330]) {
  const n = Math.round(seconds * sr), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t); L[i] = 0.4 * env * Math.sin(2 * Math.PI * freqs[0] * t); R[i] = 0.4 * env * Math.sin(2 * Math.PI * (freqs[1] || freqs[0]) * t); if (i % Math.round(sr / 2) < 400) { L[i] += 0.3 * (Math.random() - 0.5); R[i] += 0.3 * (Math.random() - 0.5); } }
  return Buffer.from(encodeWAV({ sampleRate: sr, channels: [L, R] }));
}
export async function openApp(page) {
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('./'); await page.waitForFunction(() => window.sada?.project);
  return errors;
}
export async function importWav(page, name = 'song.wav', buf = testWav()) {
  await page.setInputFiles('#fileInput', { name, mimeType: 'audio/wav', buffer: buf });
  await page.waitForFunction((n) => window.sada.project.tracks.some((t) => t.clips.length), name);
}
export const dur = (page) => page.evaluate(() => window.sada.projectDuration());
export async function dragSelect(page, fromFrac, toFrac) {
  const box = await page.getByTestId('wave').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * fromFrac, y); await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((fromFrac + toFrac) / 2), y, { steps: 4 });
  await page.mouse.move(box.x + box.width * toFrac, y, { steps: 4 }); await page.mouse.up();
}
export const tool = (page, id) => page.locator(`#toolbar [data-action="${id}"]`).click();
export const tab = (page, id) => page.locator(`#tabs [data-tab="${id}"]`).click();
