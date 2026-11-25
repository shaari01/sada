import { test, expect } from '@playwright/test';
import { openApp, importWav, dur, dragSelect, tool, tab } from './util.js';

test('phase 1: open, select, cut/copy/paste/delete, reorder, export, autosave', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await importWav(page);
  await page.waitForTimeout(300);
  expect(await dur(page)).toBeCloseTo(6, 1);
  await page.screenshot({ path: 'test-results/p1-loaded.png' });

  // select ~ [1.5s, 3s] by dragging (fit view: whole 6s across the width)
  await dragSelect(page, 0.25, 0.5);
  const sel = await page.evaluate(() => window.sada.state.selection);
  expect(sel[1] - sel[0]).toBeGreaterThan(1);
  const selLen = sel[1] - sel[0];

  await tool(page, 'cut');
  expect(await dur(page)).toBeCloseTo(6 - selLen, 1);
  await page.keyboard.press('Control+z');
  expect(await dur(page)).toBeCloseTo(6, 1);
  await page.keyboard.press('Control+y');
  expect(await dur(page)).toBeCloseTo(6 - selLen, 1);
  // paste back at cursor
  await tool(page, 'paste');
  expect(await dur(page)).toBeCloseTo(6, 1);

  // copy + paste duplicates
  await dragSelect(page, 0.05, 0.15);
  const s2 = await page.evaluate(() => window.sada.state.selection);
  await tool(page, 'copy');
  await page.evaluate(() => { window.sada.state.selection = null; window.sada.state.cursor = 0; });
  await tool(page, 'paste');
  expect(await dur(page)).toBeCloseTo(6 + (s2[1] - s2[0]), 1);
  await page.keyboard.press('Control+z');

  // delete via keyboard
  await dragSelect(page, 0.6, 0.7);
  const s3 = await page.evaluate(() => window.sada.state.selection);
  await page.keyboard.press('Delete');
  expect(await dur(page)).toBeCloseTo(6 - (s3[1] - s3[0]), 1);
  await page.keyboard.press('Control+z');

  // split into cards and reorder by dragging the last card to the front
  const nBefore = await page.evaluate(() => window.sada.project.tracks[0].clips.length);
  await dragSelect(page, 0.3, 0.6);
  await tool(page, 'split');
  const cards = page.getByTestId('card');
  await expect(cards).toHaveCount(nBefore + 2);
  const nCards = nBefore + 2;
  const firstOffsetBefore = await page.evaluate(() => [...window.sada.project.tracks[0].clips].sort((a, b) => a.start - b.start)[0].offset);
  const c3 = await cards.nth(nCards - 1).boundingBox(), c1 = await cards.nth(0).boundingBox();
  await page.mouse.move(c3.x + c3.width / 2, c3.y + c3.height / 2); await page.mouse.down();
  await page.mouse.move(c1.x + 10, c1.y + c1.height / 2, { steps: 8 }); await page.mouse.up();
  const firstOffsetAfter = await page.evaluate(() => [...window.sada.project.tracks[0].clips].sort((a, b) => a.start - b.start)[0].offset);
  expect(firstOffsetAfter).not.toBeCloseTo(firstOffsetBefore, 2);
  expect(await dur(page)).toBeCloseTo(6, 1);
  await page.screenshot({ path: 'test-results/p1-cards.png' });

  // markers
  await page.evaluate(() => { window.sada.state.cursor = 1; });
  await tool(page, 'marker');
  await page.locator('dialog .btn.primary').click();
  expect(await page.evaluate(() => window.sada.project.markers.length)).toBe(1);

  // exports
  await tab(page, 'export');
  for (const fmt of ['wav', 'mp3']) {
    const dl = page.waitForEvent('download');
    await tool(page, 'export');
    await page.locator(`dialog .seg button:has-text("${fmt.toUpperCase()}")`).click();
    await page.locator('dialog .btn.primary').click();
    const d = await dl; const path = await d.path(); const fs = await import('fs'); const b = fs.readFileSync(path);
    expect(d.suggestedFilename()).toMatch(new RegExp(`\\.${fmt}$`));
    if (fmt === 'wav') { expect(b.subarray(0, 4).toString()).toBe('RIFF'); expect(b.length).toBeGreaterThan(6 * 44100 * 4 * 0.9); }
    else { expect(b.length).toBeGreaterThan(50000); expect(b[0] === 0xff || b.subarray(0, 3).toString() === 'ID3').toBe(true); }
  }

  // autosave + reload restores the project
  await page.waitForTimeout(1600);
  await page.reload(); await page.waitForFunction(() => window.sada?.project?.tracks?.[0]?.clips?.length > 0);
  expect(await dur(page)).toBeCloseTo(6, 1);
  expect(await page.evaluate(() => window.sada.project.markers.length)).toBe(1);
  expect(errors).toEqual([]);
});

test('phase 1: works offline after first visit (PWA)', async ({ page, context }) => {
  await openApp(page);
  await page.waitForFunction(() => navigator.serviceWorker?.controller || new Promise((r) => navigator.serviceWorker.ready.then(() => r(true))), null, { timeout: 20000 });
  await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload(); await page.waitForFunction(() => window.sada?.project);
  await expect(page.locator('.brand b')).toHaveText('صدى');
  const manifest = await page.evaluate(() => fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json()));
  expect(manifest.dir).toBe('rtl'); expect(manifest.lang).toBe('ar');
  await context.setOffline(false);
});
