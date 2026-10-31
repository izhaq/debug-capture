/**
 * S-15a (release 2.4) on the hostile host (strict CSP + Trusted Types, hostile
 * CSS, the real capture controller): Settings › Text size − / + / Reset,
 * 10…20 px, live and remembered; the chrome grows with the text; every
 * toolbar control stays on screen at 1280 × 720 with 20 px text; a 2.3 stored
 * "large" opens at 14 px (FR-TXT-01…05). Every test also checks that the page
 * saw no CSP violation and no page error.
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const TOGGLE = 'Control+Alt+Shift+KeyP';
const PANEL = 'debug-capture-panel-v2';
const KEY = 'debug-capture:panel';
const FRAME_CONTROLS = ['Pause', 'Capture', 'Clear', 'Export', 'Settings', 'Maximize panel', 'Close debug panel'];

let pageErrors;

test.use({ viewport: { width: 1280, height: 720 } });

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

/** The hostile host with one HTTP request and one log line; `stored` is written before the panel reads it. */
async function load(page, stored = null) {
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  if (stored) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, JSON.stringify(stored)]);
    await page.reload();
    await page.waitForFunction(() => window.__ready === true);
  }
  await seed(page);
}

/** One HTTP request and one log line, so the HTTP list has a row to measure. */
function seed(page) {
  return page.evaluate(() => {
    const { recorder, clock } = window.__dc.controller.session;
    const t = clock.now();
    recorder.record({
      kind: 'http',
      t,
      transport: 'fetch',
      method: 'GET',
      url: `${location.origin}/api/orders?page=1`,
      status: 200,
      durationMs: 9,
      reqHeaders: {},
      resHeaders: {},
      reqBody: null,
      resBody: '[]',
      bytes: 2,
      error: null,
    });
    recorder.record({ kind: 'log', t, level: 'log', args: ['hello'] });
  });
}

async function open(page) {
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(`${PANEL} .dcp-http`)).toBeVisible();
  // Rows come in the next frame's batch: wait for the seeded request's row before measuring.
  await expect(page.locator(`${PANEL} .dcp-http .dcp-vlist__body > [role="row"]`).first()).toBeVisible();
}

const settings = (page) => page.locator(`${PANEL} .dcp-pop[aria-label="Settings"]`);
const step = (page, name) => settings(page).getByRole('button', { name, exact: true });
const value = (page) => settings(page).locator('[data-text-size-value]');

/** Sizes as drawn: the root's font, a row, the title bar, a toolbar button, an icon, the status bar. */
function measure(page) {
  return page.evaluate((tag) => {
    const root = document.querySelector(tag).shadowRoot;
    const h = (sel) => Math.round(root.querySelector(sel).getBoundingClientRect().height);
    return {
      font: getComputedStyle(root.querySelector('.dcp-root')).fontSize,
      row: h('.dcp-http .dcp-vlist__body > [role="row"]'),
      titlebar: h('.dcp-titlebar'),
      button: h('.dcp-toolbar .dcp-btn'),
      icon: h('.dcp-toolbar .dcp-icon'),
      status: h('.dcp-statusbar'),
    };
  }, PANEL);
}

/** Each named control (or selector) not fully inside both the window and the panel. */
function outside(page, names, selectors) {
  return page.evaluate(
    ([tag, names, selectors]) => {
      const root = document.querySelector(tag).shadowRoot;
      const panel = root.querySelector('.dcp-root').getBoundingClientRect();
      const inside = (r) =>
        r.width > 0 &&
        r.height > 0 &&
        r.left >= Math.max(0, panel.left) - 0.5 &&
        r.top >= Math.max(0, panel.top) - 0.5 &&
        r.right <= Math.min(innerWidth, panel.right) + 0.5 &&
        r.bottom <= Math.min(innerHeight, panel.bottom) + 0.5;
      const bad = [];
      for (const name of names) {
        const el = [...root.querySelectorAll('button')].find(
          (b) => b.getAttribute('aria-label') === name || b.textContent.trim() === name,
        );
        if (!el || !inside(el.getBoundingClientRect())) bad.push(name);
      }
      for (const selector of selectors) {
        const el = root.querySelector(selector);
        if (!el || !inside(el.getBoundingClientRect())) bad.push(selector);
      }
      return bad;
    },
    [PANEL, names, selectors],
  );
}

test('FR-TXT-01…04: + up to 20 px, − down to 10, Reset to 12 — live, the chrome grows, kept after a reload', async ({
  page,
}) => {
  await load(page);
  await open(page);
  expect(await measure(page)).toEqual({ font: '12px', row: 22, titlebar: 32, button: 24, icon: 14, status: 22 });

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(value(page)).toHaveText('12 px');
  await expect(step(page, 'Reset text size')).toBeDisabled();
  for (let n = 13; n <= 20; n++) {
    await step(page, 'Larger text').click();
    await expect(value(page)).toHaveText(`${n} px`);
  }
  await expect(step(page, 'Larger text')).toBeDisabled();
  expect(await measure(page)).toEqual({ font: '20px', row: 38, titlebar: 44, button: 36, icon: 20, status: 28 });
  expect(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY)).textSize).toBe(20);

  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await seed(page);
  await open(page);
  expect((await measure(page)).row, 'the stored size, before Settings is opened').toBe(38);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(value(page)).toHaveText('20 px');
  for (let n = 19; n >= 10; n--) await step(page, 'Smaller text').click();
  await expect(value(page)).toHaveText('10 px');
  await expect(step(page, 'Smaller text')).toBeDisabled();
  await step(page, 'Reset text size').click();
  await expect(value(page)).toHaveText('12 px');
  await expect(step(page, 'Reset text size')).toBeDisabled();
});

test('FR-TXT-05, NFR-COMP-02: at 1280 × 720 with 20 px text every toolbar control and the filter box are on screen, docked bottom and right', async ({
  page,
}) => {
  await load(page, { v: 1, textSize: 20 });
  await open(page);
  const parts = [
    '.dcp-statusbar',
    '#dcp-tab-network',
    '#dcp-tab-console',
    '.dcp-http input[aria-label="Filter requests"]',
  ];
  expect(await outside(page, FRAME_CONTROLS, parts)).toEqual([]);

  const pop = '.dcp-pop[aria-label="Settings"]';
  await page.getByRole('button', { name: 'Settings' }).click();
  expect(await outside(page, [], [pop]), 'Settings fits in the panel, docked bottom').toEqual([]);
  await settings(page).getByRole('radio', { name: 'Right' }).check();
  await page.keyboard.press('Escape');
  expect(await outside(page, FRAME_CONTROLS, parts)).toEqual([]);

  await page.getByRole('button', { name: 'Settings' }).click();
  expect(await outside(page, [], [pop]), 'Settings fits in the panel, docked right').toEqual([]);
  // The last setting is reachable: scrolled into view inside the box, it is inside the panel.
  const last = settings(page).getByRole('radio', { name: 'Off' });
  await last.scrollIntoViewIfNeeded();
  await last.check();
  await expect(page.locator(`${PANEL} .dcp-banner`).first()).toBeVisible();
});

test('FR-TXT-04: a 2.3 stored "large" opens at 14 px — the same look as 2.3', async ({ page }) => {
  await load(page, { v: 1, textSize: 'large' });
  await open(page);
  expect(await measure(page)).toEqual({ font: '14px', row: 26, titlebar: 32, button: 24, icon: 14, status: 22 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(value(page)).toHaveText('14 px');
});
