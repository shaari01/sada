import { test, expect } from '@playwright/test';
import { openApp, importWav, tool, tab, testWav, dragSelect } from './util.js';

async function newProj(page) { await page.locator('#topActions [aria-label="المشاريع"]').click(); await page.locator('dialog .btn.primary').first().click(); }
const last = (page) => page.evaluate(() => window.sada.state.undo.at(-1)?.label);

test('phase 6: every effect applies with preview', async ({ page }) => {
  const errors = await openApp(page); await newProj(page);
  await importWav(page, 'voice.wav', testWav(6));
  await tab(page, 'fx');
  for (const [id, label] of [['amplify', 'تضخيم'], ['normalize', 'تطبيع'], ['compressor', 'ضاغط (Compressor)'], ['eq', 'معادل الصوت'], ['echo', 'صدى (Echo)'], ['reverb', 'تردد (Reverb)'], ['denoise', 'إزالة الضوضاء'], ['hum', 'إزالة الطنين']]) {
    await dragSelect(page, 0.1, 0.5);
    await tool(page, id);
    if (id === 'reverb') { await page.locator('dialog .seg button', { hasText: 'مسجد' }).click(); await page.locator('dialog .btn', { hasText: 'معاينة' }).click(); await page.waitForFunction(() => window.sada.player.playing); }
    await page.locator('dialog .btn.primary').click();
    await page.waitForFunction((l) => window.sada.state.undo.at(-1)?.label === l, label, { timeout: 20000 });
  }
  await tool(page, 'reverse'); await page.waitForFunction(() => window.sada.state.undo.at(-1)?.label === 'عكس');
  expect(await page.evaluate(() => window.sada.projectDuration())).toBeCloseTo(6, 0);
  expect(errors).toEqual([]);
});

test('phase 6: record over music with the (fake) microphone', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  const errors = await openApp(page); await newProj(page);
  await importWav(page, 'music.wav', testWav(4));
  await tab(page, 'rec'); await tool(page, 'record');
  await page.waitForTimeout(1500);
  await page.locator('dialog .btn.primary').click();
  await page.waitForFunction(() => window.sada.project.tracks.length === 2, null, { timeout: 15000 });
  const d = await page.evaluate(() => window.sada.project.tracks[1].clips[0].duration);
  expect(d).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

test('phase 6: song separation, karaoke, formats, ringtone, send to video', async ({ page }) => {
  const errors = await openApp(page); await newProj(page);
  await importWav(page, 'song.wav', testWav(5));
  await tab(page, 'rec'); await tool(page, 'separate'); await page.locator('dialog .btn.primary').click();
  await page.waitForFunction(() => window.sada.project.tracks.length === 5, null, { timeout: 60000 });
  expect(await page.evaluate(() => window.sada.project.tracks.map((t) => t.name))).toEqual(['song', 'الصوت البشري', 'الطبول', 'الباص', 'البقية']);
  await page.screenshot({ path: 'test-results/p6-stems.png' });
  // stems sum back to the song: mix of stems ≈ original
  const diff = await page.evaluate(async () => { const s = window.sada; const a = await s.renderMixdown({ trackFilter: (t) => t.name !== 'song' }); const b = await s.renderMixdown({ trackFilter: (t) => t.name === 'song' }); let m = 0; for (let i = 2000; i < a.channels[0].length - 2000; i += 97) m = Math.max(m, Math.abs(a.channels[0][i] - b.channels[0][i])); return m; });
  expect(diff).toBeLessThan(0.02);
  await page.keyboard.press('Control+z');
  await tool(page, 'karaoke'); await page.locator('dialog .btn.primary').click(); await page.waitForFunction(() => window.sada.state.undo.at(-1)?.label.includes('كاريوكي'));
  // export formats available in this browser
  await tab(page, 'export');
  await tool(page, 'export');
  const labels = await page.locator('dialog .seg').first().locator('button').allTextContents();
  expect(labels).toContain('MP3'); expect(labels).toContain('WAV');
  for (const f of ['OGG', 'M4A']) if (labels.includes(f)) {
    await page.locator('dialog .seg').first().locator('button', { hasText: f }).click();
    const dl = page.waitForEvent('download'); await page.locator('dialog .btn.primary').click(); const d = await dl;
    expect(d.suggestedFilename().toLowerCase()).toMatch(new RegExp(f.toLowerCase() + '$'));
    await tool(page, 'export');
  }
  await page.locator('dialog header button').click();
  // ringtone
  const dl2 = page.waitForEvent('download'); await tool(page, 'ringtone'); await page.locator('dialog .btn.primary').click(); expect((await dl2).suggestedFilename()).toMatch(/^نغمة/);
  // send to video inbox (shared IndexedDB)
  await tool(page, 'sendVideo');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('أُرسل'));
  const n = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('shared-media-inbox', 1); r.onsuccess = () => { const q = r.result.transaction('items').objectStore('items').getAll(); q.onsuccess = () => res(q.result.length); }; }));
  expect(n).toBeGreaterThan(0);
  console.log('formats:', labels.join(','));
  expect(errors).toEqual([]);
});
