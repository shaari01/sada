import { test, expect } from '@playwright/test';
import { openApp, importWav, dragSelect, tool, tab, testWav } from './util.js';

test('phase 3: ramp to level, envelope editing, fades', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('#topActions [aria-label="المشاريع"]').click(); await page.locator('dialog .btn.primary').first().click();
  await importWav(page, 'tone.wav', testWav(8));
  await tab(page, 'level');
  await dragSelect(page, 0.25, 0.5);
  const s = await page.evaluate(() => window.sada.state.selection);
  await tool(page, 'ramp');
  await page.locator('dialog .chip', { hasText: 'انخفض' }).click();
  await page.locator('dialog .btn.primary').click();
  const v = await page.evaluate(() => { const env = window.sada.track.envelope; return { n: env.length, last: env.at(-1).v }; });
  // the real mix is quieter after the ramp: compare RMS before the ramp and at the end
  const ratio = await page.evaluate(async ([a]) => { const m = await window.sada.renderMixdown(); const sr = m.sampleRate, L = m.channels[0]; const rms = (t0, t1) => { let s = 0, n = 0; for (let i = Math.round(t0 * sr); i < Math.round(t1 * sr); i++) { s += L[i] * L[i]; n++; } return Math.sqrt(s / n); }; return rms(6, 8) / rms(Math.max(0, a - 2), a); }, s);
  expect(ratio).toBeGreaterThan(0.2); expect(ratio).toBeLessThan(0.45);
  expect(v.last).toBeCloseTo(0.3); expect(v.n).toBeGreaterThanOrEqual(2);
  // envelope tool: tap adds a point, drag moves it
  await tool(page, 'envTool');
  const box = await page.getByTestId('wave').boundingBox();
  const n0 = await page.evaluate(() => window.sada.track.envelope.length);
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.6);
  expect(await page.evaluate(() => window.sada.track.envelope.length)).toBe(n0 + 1);
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.6); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.86, box.y + box.height * 0.2, { steps: 5 }); await page.mouse.up();
  const hi = await page.evaluate(() => Math.max(...window.sada.track.envelope.map((p) => p.v)));
  expect(hi).toBeGreaterThan(1);
  await page.screenshot({ path: 'test-results/p3-envelope.png' });
  await tool(page, 'envTool');
  // fade in on whole track (first 3 s)
  await page.evaluate(() => { window.sada.state.selection = null; });
  await tool(page, 'fadeIn'); await page.locator('dialog .btn.primary').click();
  await page.waitForFunction(() => window.sada.state.undo.at(-1)?.label === 'تلاشي دخول');
  // exported mix reflects envelope: render and check level drop after ramp
  expect(errors).toEqual([]);
});
