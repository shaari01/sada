import { test, expect, devices } from '@playwright/test';
import { openApp, importWav, dragSelect, tool } from './util.js';
for (const [name, dev] of [['phone', devices['Galaxy S9+']], ['tablet', devices['Galaxy Tab S4']]]) {
  test.describe(name, () => {
    const { defaultBrowserType, ...d } = dev; test.use(d);
    test(`layout and touch editing on ${name}`, async ({ page }) => {
      const errors = await openApp(page);
      await page.locator('#topActions [aria-label="المشاريع"]').click(); await page.locator('dialog .btn.primary').first().click();
      await importWav(page);
      // no horizontal page overflow; toolbar buttons are big enough to touch
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && window.innerWidth === screen.width)).toBe(true);
      expect(await page.evaluate(() => document.querySelector('.tl-ruler').getBoundingClientRect().width <= window.innerWidth)).toBe(true);
      const b = await page.locator('#toolbar .tbtn').first().boundingBox(); expect(b.width).toBeGreaterThanOrEqual(64); expect(b.height).toBeGreaterThanOrEqual(64);
      // touch-drag selection then cut via tap
      const box = await page.getByTestId('wave').boundingBox(); const y = box.y + box.height / 2;
      await page.touchscreen.tap(box.x + box.width * 0.2, y);
      expect(await page.evaluate(() => window.sada.state.cursor)).toBeGreaterThan(0.5);
      await dragSelect(page, 0.2, 0.5);
      await tool(page, 'cut');
      expect(await page.evaluate(() => window.sada.projectDuration())).toBeLessThan(5.5);
      await page.screenshot({ path: `test-results/dev-${name}.png` });
      await page.locator('#viewSwitch [data-view="multi"]').click();
      await page.screenshot({ path: `test-results/dev-${name}-multi.png` });
      expect(errors).toEqual([]);
    });
  });
}
