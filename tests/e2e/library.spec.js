import { test, expect } from '@playwright/test';
import { openApp, importWav, tool, tab, testWav, dragSelect } from './util.js';

async function newProj(page) { await page.locator('#topActions [aria-label="المشاريع"]').click(); await page.locator('dialog .btn.primary').first().click(); }
const wav = (name, s = 2, f = [440]) => ({ name, mimeType: 'audio/wav', buffer: testWav(s, 44100, f) });

test('library: add / insert / delete own sounds, own reverb room, own presets, hide built-ins', async ({ page }) => {
  const errors = await openApp(page); await newProj(page);
  await importWav(page, 'song.wav', testWav(4));
  await tab(page, 'library');

  // add a sound file to "أصواتي"
  const fc = page.waitForEvent('filechooser'); await tool(page, 'libAddSound'); await (await fc).setFiles(wav('بسملة.wav', 2));
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('أصواتي'));
  // save the selection as a sound too
  await dragSelect(page, 0.1, 0.3); await tool(page, 'libSaveSel');
  await page.locator('dialog .btn.primary').click();
  await page.waitForTimeout(200);

  // open the library, insert «بسملة» on a new track, then delete it
  await tool(page, 'library');
  await expect(page.locator('.lib-row')).toHaveCount(2);
  await page.locator('.lib-row[data-asset="بسملة"] .lib-b[aria-label="مسار جديد"]').click();
  await page.waitForFunction(() => window.sada.project.tracks.length === 2);
  await page.locator('.lib-row[data-asset="بسملة"] .lib-b[aria-label="حذف"]').click();
  await page.locator('dialog:last-of-type .btn.primary').click();
  await expect(page.locator('.lib-row')).toHaveCount(1);

  // hide a built-in reverb
  await page.locator('dialog .lib .seg button', { hasText: 'الجاهزة' }).click();
  await page.locator('.lib-row[data-builtin="reverb:space"] .lib-b').click();
  await expect(page.locator('.lib-row[data-builtin="reverb:space"]')).toHaveClass(/off/);
  await page.locator('dialog .dlg-body + footer .btn').click();

  // add an own reverb room (IR)
  const fc2 = page.waitForEvent('filechooser'); await tool(page, 'libAddIR'); await (await fc2).setFiles(wav('قاعتي.wav', 1, [1000]));
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('غرفة'));

  // reverb dialog: own room is listed, the hidden one is not; save a preset, then apply with the own room
  await page.evaluate(() => { window.sada.state.project.activeTrackId = window.sada.project.tracks[0].id; });
  await tab(page, 'fx'); await dragSelect(page, 0.1, 0.5); await tool(page, 'reverb');
  const labels = await page.locator('dialog .seg button').allTextContents();
  expect(labels).toContain('قاعتي'); expect(labels).not.toContain('فضاء');
  await page.locator('dialog .seg button', { hasText: 'قاعتي' }).click();
  await page.locator('dialog [data-action="savePreset"]').click();
  await page.locator('dialog:last-of-type .inp').fill('صوت القاعة');
  await page.locator('dialog:last-of-type .btn.primary').click();
  await expect(page.locator('dialog .uchip-main', { hasText: 'صوت القاعة' })).toBeVisible();
  await page.locator('dialog .btn.primary', { hasText: 'اعتماد' }).click();
  await page.waitForFunction(() => window.sada.state.undo.at(-1)?.label === 'تردد (Reverb)', null, { timeout: 20000 });

  // assets survive a reload (IndexedDB)
  await page.reload(); await page.waitForFunction(() => window.sada?.project);
  await tab(page, 'library'); await tool(page, 'library');
  await page.locator('dialog .lib .seg button', { hasText: 'قوالبي' }).click();
  await expect(page.locator('.lib-row[data-asset="صوت القاعة"]')).toBeVisible();
  await page.locator('dialog .lib .seg button', { hasText: 'غرف التردد' }).click();
  await expect(page.locator('.lib-row[data-asset="قاعتي"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/library.png' });
  expect(errors).toEqual([]);
});
