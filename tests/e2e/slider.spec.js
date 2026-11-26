import { test, expect } from '@playwright/test';
import { openApp, importWav, tool, tab } from './util.js';
test('touch-safe slider and live preview', async ({ page }) => {
  await openApp(page); await importWav(page);
  await tab(page, 'fx'); await tool(page, 'amplify');
  await page.waitForFunction(() => window.sada.player.playing && window.sada.player.preview); // preview starts by itself
  const val = page.locator('dialog .sr-val').first(), tr = page.locator('dialog .sr-track').first();
  const v0 = await val.textContent(); const b = await tr.boundingBox();
  await page.mouse.click(b.x + b.width * 0.05, b.y + b.height / 2); // click far from thumb → ignored
  expect(await val.textContent()).toBe(v0);
  const thumb = await page.locator('dialog .sr-thumb').first().boundingBox();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2); await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2 - b.width * 0.3, thumb.y + thumb.height / 2, { steps: 5 }); await page.mouse.up();
  expect(await val.textContent()).not.toBe(v0);
  await page.locator('dialog .sr-step', { hasText: '+' }).first().click();
  await page.locator('dialog .btn.primary').click();
  await page.waitForFunction(() => window.sada.state.undo.at(-1)?.label === 'تضخيم');
  expect(await page.evaluate(() => window.sada.player.playing)).toBe(false);
});
