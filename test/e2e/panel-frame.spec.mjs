/**
 * S-08 frame on the hostile host (strict CSP + Trusted Types, hostile CSS,
 * the real capture controller): resize, dock, maximize, fullscreen, the
 * host-dialog banner, capture off / on and settings kept across a reload
 * (FR-WIN-01…04, FR-WIN-07, FR-ACT-09, ISO-13, ISO-19, ISO-21, D-15, D-20).
 * Every test also checks that the page saw no CSP violation and no page error.
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const TOGGLE = 'Control+Alt+Shift+KeyP';
const PANEL = 'debug-capture-panel-v2';

let pageErrors;

test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});

test.afterEach(async ({ page }) => {
  const host = await page.evaluate(() => window.__host ?? null).catch(() => null);
  if (host) {
    expect(host.violations, 'CSP / Trusted Types violations').toEqual([]);
    expect(host.errors, 'window errors and unhandled rejections').toEqual([]);
  }
  expect(pageErrors).toEqual([]);
});

async function openPanel(page) {
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(`${PANEL} .dcp-frame`)).toBeVisible();
}

/** The panel root's box. */
const rootBox = (page) =>
  page.evaluate(() => {
    const r = document.querySelector('html > debug-capture-panel-v2').shadowRoot.querySelector('.dcp-root');
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height, vw: innerWidth, vh: innerHeight };
  });

const hostLayout = (page) =>
  page.evaluate(() => {
    const r = document.getElementById('app').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, scrollY };
  });

test('FR-WIN-03, ISO-19, ISO-13: dragging the edge resizes the panel; the host page keeps its layout and sees no move event', async ({
  page,
}) => {
  await openPanel(page);
  const before = await rootBox(page);
  const layout = await hostLayout(page);
  await page.evaluate(() => (window.__host.bubbled = []));

  const edge = page.locator(`${PANEL} .dcp-resize`);
  const e = await edge.boundingBox();
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2, e.y - 100, { steps: 5 });
  await page.mouse.up();

  const after = await rootBox(page);
  expect(after.height).toBeGreaterThan(before.height + 90);
  expect(after.height).toBeLessThan(before.height + 110);
  expect(await hostLayout(page)).toEqual(layout);
  const bubbled = await page.evaluate(() => window.__host.bubbled);
  expect(bubbled.filter((e) => /^(pointer|mouse)move@/.test(e))).toEqual([]);
});

test('FR-WIN-01/02: dock right from Settings — full height on the right; maximize fills the window and toggles back', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Right' }).check();
  await page.keyboard.press('Escape');

  const right = await rootBox(page);
  expect(Math.round(right.x + right.width)).toBe(right.vw);
  expect(Math.round(right.height)).toBe(right.vh);
  expect(right.width).toBeLessThan(right.vw);

  await page.getByRole('button', { name: 'Maximize panel' }).click();
  const max = await rootBox(page);
  expect([Math.round(max.x), Math.round(max.y), Math.round(max.width), Math.round(max.height)]).toEqual([
    0,
    0,
    max.vw,
    max.vh,
  ]);
  await page.getByRole('button', { name: 'Restore panel size' }).click();
  expect(await rootBox(page)).toEqual(right);
});

test('D-15, FR-WIN-07: in fullscreen the launcher and the panel are drawn on top and the panel says it cannot be used; after fullscreen it works again', async ({
  page,
}) => {
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  await page.locator('#host-input').focus();
  await page.evaluate(() => document.getElementById('app').requestFullscreen());
  await page.waitForFunction(() => document.fullscreenElement?.id === 'app');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

  // Drawn on top of the fullscreen element: taking our element out of the top layer changes those pixels.
  const l = await page.locator(`${PANEL} .dcp-launcher`).boundingBox();
  const clip = { x: l.x, y: l.y, width: l.width, height: l.height };
  const shown = await page.screenshot({ clip });
  await page.evaluate(() => document.querySelector('html > debug-capture-panel-v2').hidePopover());
  const hidden = await page.screenshot({ clip });
  await page.evaluate(() => document.querySelector('html > debug-capture-panel-v2').showPopover());
  expect(shown.equals(hidden)).toBe(false);

  // Chrome keeps clicks and focus inside the fullscreen element (it matches :modal), so the
  // shortcut opens the panel to look at, and the banner says it cannot be used until then.
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(`${PANEL} .dcp-frame`)).toBeVisible();
  const banner = page.locator(`${PANEL} .dcp-banner`, { hasText: 'is fullscreen' });
  await expect(banner).toBeVisible();

  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.fullscreenElement === null);
  await expect(banner).toBeHidden();
  await page.getByRole('button', { name: 'Close debug panel' }).click();
  await expect(page.locator(`${PANEL} .dcp-launcher`)).toBeVisible();
});

test('ISO-21, FR-WIN-07: a host modal dialog shows the banner while it is open; closing it hides the banner', async ({
  page,
}) => {
  await openPanel(page);
  const banner = page.locator(`${PANEL} .dcp-banner`, { hasText: 'has a dialog open' });
  await expect(banner).toBeHidden();

  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.id = 'host-modal';
    dialog.textContent = 'Host modal';
    document.body.appendChild(dialog);
    dialog.showModal();
  });
  await expect(banner).toBeVisible();

  await page.evaluate(() => document.getElementById('host-modal').close());
  await expect(banner).toBeHidden();
});

test('FR-ACT-09, D-19: Capture off records nothing new and shows the banner; Turn on records again', async ({
  page,
}) => {
  await openPanel(page);
  const recorded = () => page.evaluate(() => window.__dc.controller.session.recorder.stats().recorded);
  const banner = page.locator(`${PANEL} .dcp-banner`, { hasText: 'Capture is off' });

  await page.evaluate(() => console.log('while on'));
  const on = await recorded();
  expect(on).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(banner).toBeVisible();
  await expect(page.locator(`${PANEL} .dcp-statusbar`)).toContainText('off');
  expect(await page.evaluate(() => window.__dc.controller.on)).toBe(false);
  await page.evaluate(() => console.log('while off'));
  expect(await recorded()).toBe(on);

  await banner.getByRole('button', { name: 'Turn on' }).click();
  await expect(banner).toBeHidden();
  await page.evaluate(() => console.log('on again'));
  expect(await recorded()).toBe(on + 1);
});

test('D-20, S08-11: the dock and a filter chip are kept across a reload in the real localStorage', async ({ page }) => {
  await openPanel(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Right' }).check();
  await page.keyboard.press('Escape');
  const chip = () => page.getByRole('group', { name: 'Status' }).getByRole('button', { name: '4xx' });
  await chip().click();
  await expect(chip()).toHaveAttribute('aria-pressed', 'true');
  // The frame writes on its next frame: wait for the chip to reach storage.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('debug-capture:panel') ?? '')).toContain('4xx');
  const right = await rootBox(page);

  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(`${PANEL} .dcp-frame`)).toBeVisible();

  await expect(chip()).toHaveAttribute('aria-pressed', 'true');
  expect(await rootBox(page)).toEqual(right);
});
