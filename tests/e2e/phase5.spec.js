import { test, expect } from '@playwright/test';
import { openApp, tool, tab } from './util.js';
import { encodeWAV } from '../../src/export/wav.js';

function beats(bpm, seconds, freq, sr = 44100) {
  const n = Math.round(seconds * sr), x = new Float32Array(n), p = 60 / bpm;
  for (let t = 0.05; t < seconds; t += p) { const s = Math.round(t * sr); for (let i = 0; i < 4000 && s + i < n; i++) x[s + i] += Math.exp(-i / 500) * (0.6 * Math.sin((2 * Math.PI * freq * i) / sr) + 0.3 * (Math.random() - 0.5)); }
  return Buffer.from(encodeWAV({ sampleRate: sr, channels: [x, x] }));
}
test('phase 5: BPM detection, grid, match tempo and key', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('#topActions [aria-label="المشاريع"]').click(); await page.locator('dialog .btn.primary').first().click();
  await page.setInputFiles('#fileInput', { name: 'song.wav', mimeType: 'audio/wav', buffer: beats(120, 16, 220) });
  await page.waitForFunction(() => window.sada.project.tracks[0].clips.length);
  await tab(page, 'rhythm'); await tool(page, 'detectBpm');
  const bpm = parseFloat(await page.getByTestId('bpm').textContent());
  expect(Math.abs(bpm - 120)).toBeLessThan(2);
  await page.locator('dialog .btn.primary').click();
  expect(await page.evaluate(() => window.sada.project.grid)).toBe(true);
  await page.locator('#viewSwitch [data-view="multi"]').click();
  // add a 100 BPM loop on a new track, then match its tempo to 120
  await page.evaluate(() => { window.sada._importNewTrack = true; });
  await page.setInputFiles('#fileInput', { name: 'loop.wav', mimeType: 'audio/wav', buffer: beats(100, 9.6, 330) });
  await page.waitForFunction(() => window.sada.project.tracks.length === 2);
  await page.evaluate(() => { const s = window.sada; s.state.selectedClipId = s.project.tracks[1].clips[0].id; });
  await tool(page, 'matchTempo'); await page.locator('dialog .btn.primary').click();
  await page.waitForFunction(() => window.sada.state.undo.at(-1)?.label === 'مطابقة السرعة');
  const d = await page.evaluate(() => { const c = window.sada.project.tracks[1].clips; return c.reduce((m, x) => Math.max(m, x.start + x.duration), 0); });
  expect(d).toBeCloseTo(9.6 * 100 / 120, 0);
  await page.screenshot({ path: 'test-results/p5-grid.png' });
  // match key runs (result depends on detection)
  await page.evaluate(() => { const s = window.sada; s.state.selectedClipId = s.project.tracks[1].clips[0].id; });
  await tool(page, 'matchKey');
  await page.waitForTimeout(1500);
  if (await page.locator('dialog .btn.primary').count()) await page.locator('dialog .btn.primary').click();
  expect(errors).toEqual([]);
});
