/**
 * S-06 WebSocket view on the hostile host (strict CSP + Trusted Types, hostile
 * CSS, the real capture controller): a real socket to the server's echo opens,
 * sends text and binary, gets both back and closes with a code and reason;
 * the connections and messages lists show it; the chips and the search filter;
 * the detail shows base64 + hex and Info; Copy message reaches the clipboard by
 * a real click inside the shadow root; no host bubble listener sees any of it
 * (FR-WS-01…06, D-26, ISO-07, AGENTS rule 29). Every test also checks that the
 * page saw no CSP violation and no page error.
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const ECHO = `${ORIGIN.replace(/^http/, 'ws')}/ws-echo`;
const TOGGLE = 'Control+Alt+Shift+KeyP';
const PANEL = 'debug-capture-panel-v2';
const VIEW = `${PANEL} .dcp-ws`;

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

/** The message row at `index` (0-based) as the user sees it: rows are recycled, so find it by `aria-rowindex`. */
const row = (page, index) =>
  page.locator(`${VIEW} .dcp-list-pane .dcp-vlist__body [role="row"][aria-rowindex="${index + 2}"]`);
const rows = (page) => page.locator(`${VIEW} .dcp-list-pane .dcp-vlist__body [role="row"]:not([hidden])`);
const chip = (page, group, label) =>
  page.locator(`${VIEW} [role="group"][aria-label="${group}"] button`, { hasText: label });

/** Opens the panel on Network › WebSocket. */
async function openWsView(page) {
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await page.locator(`${PANEL} #dcp-subtab-ws`).click();
  await expect(page.locator(VIEW)).toBeVisible();
}

test('FR-WS-01…05: a real socket — open, text and binary both ways, close with code and reason; lists, filters, detail', async ({
  page,
}) => {
  await openWsView(page);
  await expect(page.locator(`${VIEW} .dcp-empty:not([hidden])`)).toHaveText('No WebSocket connections yet.');

  const closed = await page.evaluate(
    (url) =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        let echoed = 0;
        socket.onopen = () => {
          socket.send('{"cmd":"hello","n":1}');
          socket.send(new Uint8Array([0x41, 0x42, 0x00, 0xff]));
        };
        socket.onmessage = () => {
          if (++echoed === 2) socket.close(4000, 'done here');
        };
        socket.onclose = (event) => resolve({ code: event.code, reason: event.reason });
        socket.onerror = () => reject(new Error('socket error'));
      }),
    ECHO,
  );
  expect(closed).toEqual({ code: 4000, reason: 'done here' });

  // S06-01: the connection, closed, with its counts; "All connections" last.
  const conns = page.locator(`${VIEW} .dcp-ws-conns [role="row"]:not([hidden])`);
  await expect(conns).toHaveCount(2);
  await expect(conns.filter({ hasText: '#1' })).toContainText(`closed #1 ${ECHO}`);
  await expect(conns.filter({ hasText: '#1' })).toContainText(' 2  2 · ');
  await expect(conns.filter({ hasText: 'All connections' })).toHaveCount(1);

  // S06-03: lifecycle and both directions, in order.
  await expect(rows(page)).toHaveCount(6);
  await expect(row(page, 0)).toContainText('opened');
  await expect(row(page, 1)).toContainText('sent');
  await expect(row(page, 1)).toContainText('{"cmd":"hello","n":1}');
  await expect(row(page, 2)).toContainText('[Binary 4 bytes]');
  await expect(row(page, 3)).toContainText('received');
  await expect(row(page, 3)).toContainText('{"cmd":"hello","n":1}');
  await expect(row(page, 4)).toContainText('[Binary 4 bytes]');
  await expect(row(page, 5)).toContainText('closed');
  await expect(row(page, 5)).toContainText('4000 "done here"');

  await page.evaluate(() => (window.__host.bubbled = []));

  // S06-04: a chip per group, then the search (highlighted).
  await chip(page, 'Direction', 'Sent').click();
  await expect(rows(page)).toHaveCount(2);
  await chip(page, 'Direction', 'All').click();
  await chip(page, 'Type', 'Binary').click();
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, 0)).toContainText('[Binary 4 bytes]');
  await chip(page, 'Type', 'All').click();
  await page.locator(`${VIEW} .dcp-filter-bar input`).fill('hello');
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, 0).locator('mark.dcp-match')).toHaveText('hello');
  await page.locator(`${VIEW} .dcp-filter-bar input`).fill('');
  await expect(rows(page)).toHaveCount(6);

  // S06-06 / 07: the received binary frame as base64 and hex; Info has the close.
  await row(page, 4).click();
  const detail = page.locator(`${VIEW} .dcp-ws-detail`);
  await expect(detail).toBeVisible();
  await expect(detail.locator('pre').first()).toHaveText('QUIA/w==');
  await expect(detail.locator('pre.dcp-ws-hex')).toContainText('00000000  41 42 00 ff');
  await expect(detail.locator('pre.dcp-ws-hex')).toContainText('AB..');
  await detail.locator('[role="tab"]', { hasText: 'Info' }).click();
  await expect(detail.locator('.dcp-ws-kv')).toContainText(ECHO);
  await expect(detail.locator('.dcp-ws-kv tr', { hasText: 'Close code' })).toContainText('4000');
  await expect(detail.locator('.dcp-ws-kv tr', { hasText: 'Close reason' })).toContainText('done here');

  // §4.12: Escape closes the detail, not the panel.
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(page.locator(VIEW)).toBeVisible();

  const host = await page.evaluate(() => window.__host);
  expect(host.bubbled).toEqual([]);
});

test('FR-WS-06, D-26, OPEN-04: Copy message by a real click inside the shadow root reaches the clipboard; the host sees no copy', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await openWsView(page);

  await page.evaluate(
    (url) =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.onopen = () => socket.send('copy me ✓');
        socket.onmessage = () => resolve();
        socket.onerror = () => reject(new Error('socket error'));
      }),
    ECHO,
  );
  await expect(row(page, 2)).toContainText('received');
  await page.evaluate(() => (window.__host.bubbled = []));

  await row(page, 1).click();
  await page.locator(`${VIEW} .dcp-ws-detail button[aria-haspopup="menu"]`).click();
  await page.locator(`${VIEW} .dcp-ws-detail [role="menuitem"]`, { hasText: 'Copy message' }).click();

  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('copy me ✓');
  const host = await page.evaluate(() => window.__host);
  expect(host.copies).toBe(0);
  expect(host.bubbled).toEqual([]);
});
