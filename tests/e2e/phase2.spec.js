import { test, expect } from '@playwright/test';
import { openApp, importWav, dur, dragSelect, tool, tab, testWav } from './util.js';

async function fresh(page) { const errors = await openApp(page); await page.evaluate(async () => { const { newProject } = await import('/src/core/project.js').catch(() => ({})); }); return errors; }

test('phase 2: fixed speed, pitch, gradual speed and curve', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('#topActions [aria-label="المشاريع"]').click(); await page.locator('dialog .btn.primary').first().click();
  await importWav(page, 'tone.wav', testWav(8, 44100, [440, 440]));
  await tab(page, 'speed');
  // fixed 2× on whole track → about half
  await tool(page, 'speed');
  await page.locator('dialog .chip', { hasText: '1.5×' }).click();
  await page.locator('dialog .btn.primary').click();
  await page.waitForFunction(() => window.sada.projectDuration() < 7);
  expect(await dur(page)).toBeCloseTo(8 / 1.5, 0);
  await page.keyboard.press('Control+z');
  expect(await dur(page)).toBeCloseTo(8, 1);
  // pitch only keeps duration
  await tool(page, 'pitch');
  await page.locator('dialog .chip', { hasText: '+2' }).click();
  await page.locator('dialog .btn.primary').click();
  await page.waitForFunction(() => window.sada.state.undo.at(-1)?.label === 'تغيير الطبقة');
  expect(await dur(page)).toBeCloseTo(8, 1);
  // gradual 1 → 1.3 on a selection
  await dragSelect(page, 0.25, 0.75);
  const s = await page.evaluate(() => window.sada.state.selection); const L = s[1] - s[0];
  await tool(page, 'gradual');
  await page.locator('dialog .btn.primary').click();
  await page.waitForFunction(() => window.sada.state.undo.at(-1)?.label === 'سرعة تدريجية');
  const expected = 8 - L + L * (Math.log(1.3) / 0.3); // integral of 1/speed for a linear ramp
  expect(Math.abs((await dur(page)) - expected)).toBeLessThan(0.25);
  // curve editor present and applies
  await tool(page, 'speedCurve');
  await expect(page.getByTestId('curve')).toBeVisible();
  await page.screenshot({ path: 'test-results/p2-curve.png' });
  await page.locator('dialog .btn.primary').click();
  await page.waitForFunction(() => window.sada.state.undo.at(-1)?.label === 'سرعة تدريجية' && window.sada.state.undo.length >= 4);
  expect(errors).toEqual([]);
});
