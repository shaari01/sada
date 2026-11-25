import { test, expect } from '@playwright/test';
import { openApp, importWav, tool, tab, testWav } from './util.js';
import fs from 'fs';

async function newProj(page) { await page.locator('#topActions [aria-label="المشاريع"]').click(); await page.locator('dialog .btn.primary').first().click(); }

test('phase 4: multitrack, mixing, move, crossfade, ducking, stems', async ({ page }) => {
  const errors = await openApp(page); await newProj(page);
  await importWav(page, 'song.wav', testWav(8, 44100, [220, 220]));
  await page.locator('#viewSwitch [data-view="multi"]').click();
  await tab(page, 'tracks');
  // second file into new track
  await page.evaluate(() => { window.sada._importNewTrack = true; });
  await page.setInputFiles('#fileInput', { name: 'oud.wav', mimeType: 'audio/wav', buffer: testWav(3, 44100, [660, 660]) });
  await page.waitForFunction(() => window.sada.project.tracks.length === 2 && window.sada.project.tracks[1].clips.length === 1);
  await expect(page.locator('.trk-h')).toHaveCount(2);
  // mute/solo/volume
  await page.locator('.trk-h').nth(1).locator('.ms.s').click();
  expect(await page.evaluate(() => window.sada.project.tracks[1].solo)).toBe(true);
  await page.locator('.trk-h').nth(1).locator('.ms.s').click();
  // move clip of track 2 with the move tool by dragging right
  await tool(page, 'moveTool');
  const box = await page.getByTestId('wave').boundingBox();
  const pps = await page.evaluate(() => window.sada.timeline.pps);
  const y2 = box.y + await page.evaluate(() => window.sada.timeline.laneH * 1.5);
  const x0 = box.x + 1.0 * pps;
  await page.mouse.move(x0, y2); await page.mouse.down(); await page.mouse.move(x0 + 2 * pps, y2, { steps: 6 }); await page.mouse.up();
  const st = await page.evaluate(() => window.sada.project.tracks[1].clips[0].start);
  expect(st).toBeGreaterThan(1.5);
  await page.screenshot({ path: 'test-results/p4-multi.png' });
  // mix contains both: render and check length = max
  const len = await page.evaluate(async () => { const m = await window.sada.renderMixdown(); return m.channels[0].length / m.sampleRate; });
  expect(len).toBeCloseTo(8, 0);
  // crossfade: put a copy of the clip right after on track 1
  await page.evaluate(() => { const s = window.sada; s.commit('t', (p) => { const t = p.tracks[0]; t.clips.push({ ...t.clips[0], id: 'c2', start: 8 }); }); s.state.selectedClipId = s.project.tracks[0].clips[0].id; s.project.activeTrackId = s.project.tracks[0].id; });
  await tool(page, 'crossfade'); await page.locator('dialog .btn.primary').click();
  const cf = await page.evaluate(() => { const c = window.sada.project.tracks[0].clips; return [c[0].fadeOut, c[1].fadeIn, c[1].start]; });
  expect(cf[0]).toBeCloseTo(2); expect(cf[1]).toBeCloseTo(2); expect(cf[2]).toBeCloseTo(6);
  // ducking: track 2 is "voice", track 1 music
  await tab(page, 'level'); await tool(page, 'duck'); await page.locator('dialog .btn.primary').click();
  const env = await page.evaluate(() => window.sada.project.tracks[0].envelope.length);
  expect(env).toBeGreaterThan(2);
  // stems export: 2 downloads
  await tab(page, 'export');
  const dl = page.waitForEvent('download');
  await tool(page, 'exportStems'); await page.locator('dialog .btn.primary').click();
  const d = await dl; expect(d.suggestedFilename()).toMatch(/\.zip$/);
  const b = fs.readFileSync(await d.path());
  expect(b.readUInt32LE(0)).toBe(0x04034b50);
  expect(b.readUInt16LE(b.length - 22 + 10)).toBe(2);
  expect(errors).toEqual([]);
});
