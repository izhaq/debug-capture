/**
 * NFR-COMP-02 (S10-15 walk): on the smallest supported screen, 1280 × 720,
 * every frame control and each view's filter bar is on screen and inside the
 * panel, docked bottom (the default) and docked right. Pointer and keyboard
 * are covered by every other e2e; touch is not required.
 *
 * Known limit (S-10 spec): docked right, the HTTP filter bar clips its last
 * status chips. This test does not check those chips there; it checks the
 * search box, which comes first.
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const TOGGLE = 'Control+Alt+Shift+KeyP';
const PANEL = 'debug-capture-panel-v2';
const FRAME_CONTROLS = ['Pause', 'Capture', 'Clear', 'Export', 'Settings', 'Maximize panel', 'Close debug panel'];

test.use({ viewport: { width: 1280, height: 720 } });

/** Each named control (or selector) that is not fully inside both the window and the panel. */
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

const VIEW_PARTS = {
  http: ['.dcp-http input[aria-label="Filter requests"]', '.dcp-http [role="columnheader"]'],
  ws: ['.dcp-ws .dcp-filter-bar input', '.dcp-ws-conns'],
  console: ['.dcp-console .dcp-filter-bar input', '.dcp-console [role="group"][aria-label="Level"]'],
};

async function checkEveryView(page) {
  const tabs = ['#dcp-tab-network', '#dcp-tab-console', '#dcp-subtab-http', '#dcp-subtab-ws'];
  expect(await outside(page, FRAME_CONTROLS, ['.dcp-statusbar', ...tabs.slice(0, 3)])).toEqual([]);
  expect(await outside(page, [], VIEW_PARTS.http)).toEqual([]);
  await page.locator(`${PANEL} #dcp-subtab-ws`).click();
  expect(await outside(page, [], VIEW_PARTS.ws)).toEqual([]);
  await page.keyboard.press('Alt+Digit2');
  expect(await outside(page, [], VIEW_PARTS.console)).toEqual([]);
  await page.keyboard.press('Alt+Digit1');
  await page.locator(`${PANEL} #dcp-subtab-http`).click();
}

test('NFR-COMP-02: at 1280 × 720 every control is on screen, docked bottom and docked right', async ({ page }) => {
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  // One entry of each kind, so every list (and its column headers) shows.
  await page.evaluate(() => {
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
    recorder.record({
      kind: 'ws',
      t,
      socketId: 1,
      url: 'wss://app.test/live',
      event: 'open',
      opcode: null,
      bytes: null,
      data: null,
      code: null,
    });
    recorder.record({ kind: 'log', t, level: 'log', args: ['hello'] });
  });
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(`${PANEL} .dcp-http`)).toBeVisible();
  await checkEveryView(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Right' }).check();
  await page.keyboard.press('Escape');
  await checkEveryView(page);
});
