/**
 * S-02, ISO-09 / NFR-PERF-05 / NFR-PERF-01 on a page with the real zone.js
 * (0.13.3, the dev dependency) and the same strict CSP + Trusted Types header:
 * the loader is installed from inside an Angular-like zone, as an Angular
 * service would do it. That zone records every task scheduled or run in it —
 * each one is a change-detection pass in a real NgZone (research P1–P5). The
 * full NgZone counter waits for S-10's Angular host.
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const TOGGLE = 'Control+Alt+Shift+KeyP';

const zone = (page) => page.evaluate(() => ({ scheduled: window.__zone.scheduled, invoked: window.__zone.invoked }));
const nextFrames = (page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('ISO-09, NFR-PERF-01/05: neither the closed loader nor the open panel schedules a task in the caller’s zone', async ({
  page,
}) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${ORIGIN}/zone.html`);
  await page.waitForFunction(() => window.__ready === true);
  expect(await page.evaluate(() => typeof window.Zone.root.fork)).toBe('function');

  // Closed: problems logged from "Angular" code, the badge repainting, mouse and keys over the page and launcher.
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) window.__zone.record();
  });
  await nextFrames(page);
  const launcher = page.locator('debug-capture-panel-v2 .dcp-launcher');
  await expect(launcher).toHaveText('DBG10');
  const box = await launcher.boundingBox();
  for (let i = 0; i < 20; i++) await page.mouse.move(box.x + (i % box.width), box.y + 5);
  await page.locator('#host-input').focus();
  await page.keyboard.type('host typing');
  expect(await zone(page)).toEqual({ scheduled: [], invoked: [] });

  // Open (UI chunk loads), use, close — from the shortcut, the launcher and the host's own API call in the zone.
  await page.keyboard.press(TOGGLE);
  await expect(page.getByRole('dialog', { name: 'Debug panel' })).toBeVisible();
  await page.locator('debug-capture-panel-v2 .dcp-title').click();
  await page.keyboard.press('Escape');
  await launcher.click();
  await page.keyboard.press(TOGGLE);
  await page.evaluate(() => window.__zone.run(() => window.__zone.handle.open()));
  await expect(page.getByRole('dialog', { name: 'Debug panel' })).toBeVisible();
  await page.evaluate(() => window.__zone.run(() => window.__zone.handle.close()));
  await nextFrames(page);

  expect(await zone(page)).toEqual({ scheduled: [], invoked: [] });
  expect(await page.evaluate(() => window.__zone.violations)).toEqual([]);
  expect(pageErrors).toEqual([]);
});
