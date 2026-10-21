/**
 * S-05 HTTP view on the hostile host (strict CSP + Trusted Types, hostile CSS,
 * the real capture controller): real fetch and XHR from the page show as
 * pending, then finish in place; a header sorts; a chip and the search filter;
 * the detail opens; Copy as cURL works by a real click inside the shadow root
 * (the copy test owed since wave 2); no host bubble listener sees any of it
 * (FR-HTTP-01…06, D-18, ISO-07, AGENTS rule 29). Every test also checks that
 * the page saw no CSP violation and no page error.
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const TOGGLE = 'Control+Alt+Shift+KeyP';
const VIEW = 'debug-capture-panel-v2 .dcp-http';

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

/** The data row at `index` (0-based) as the user sees it: rows are recycled, so find it by `aria-rowindex`. */
const row = (page, index) => page.locator(`${VIEW} .dcp-vlist__body [role="row"][aria-rowindex="${index + 2}"]`);
const header = (page, label) => page.locator(`${VIEW} [role="columnheader"]`, { hasText: label });

test('FR-HTTP-01/02/03/04, D-18: real fetch and XHR show pending then finish in place; sort, filter and detail work', async ({
  page,
}) => {
  let release;
  const held = new Promise((done) => (release = done));
  await page.route('**/api/slow', async (route) => {
    await held;
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true,"items":[1,2]}' });
  });
  await page.route('**/api/fast?q=1', (route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' }),
  );

  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(VIEW)).toBeVisible();
  await expect(page.locator(`${VIEW} .dcp-empty`).first()).toHaveText('No requests yet.');

  await page.evaluate(() => {
    fetch('/api/slow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' }).catch(
      () => undefined,
    );
    setTimeout(() => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/fast?q=1');
      xhr.send();
    }, 20);
  });

  // Start order: the slow fetch first, pending; the XHR after it, finished.
  await expect(row(page, 0)).toContainText('slow');
  await expect(row(page, 0)).toContainText('Pending');
  await expect(row(page, 1)).toContainText('fast?q=1');
  await expect(row(page, 1)).toContainText('404');

  release();
  await expect(row(page, 0)).toContainText('201');
  await expect(row(page, 0)).toContainText('slow');
  await expect(row(page, 1)).toContainText('404');

  await page.evaluate(() => (window.__host.bubbled = []));

  // D-18: Status ascending, then descending.
  await header(page, 'Status').locator('button').click();
  await expect(header(page, 'Status')).toHaveAttribute('aria-sort', 'ascending');
  await expect(row(page, 0)).toContainText('201');
  await header(page, 'Status').locator('button').click();
  await expect(header(page, 'Status')).toHaveAttribute('aria-sort', 'descending');
  await expect(row(page, 0)).toContainText('404');

  // S05-02: the header is a real button, so Enter and Space sort too (start order → ascending → descending).
  await header(page, 'Status').locator('button').focus();
  await page.keyboard.press('Enter');
  await expect(header(page, 'Status')).not.toHaveAttribute('aria-sort');
  await expect(row(page, 0)).toContainText('slow');
  await page.keyboard.press('Space');
  await expect(header(page, 'Status')).toHaveAttribute('aria-sort', 'ascending');
  await expect(row(page, 0)).toContainText('201');
  await page.keyboard.press('Enter');
  await expect(header(page, 'Status')).toHaveAttribute('aria-sort', 'descending');
  await expect(row(page, 0)).toContainText('404');

  // FR-HTTP-03: a chip, then the search.
  await page.locator(`${VIEW} [role="group"][aria-label="Status"] button`, { hasText: '2xx' }).click();
  await expect(page.locator(`${VIEW} .dcp-vlist__body [role="row"]`)).toHaveCount(1);
  await expect(row(page, 0)).toContainText('slow');
  await page.locator(`${VIEW} [role="group"][aria-label="Status"] button`, { hasText: 'All' }).click();
  await page.locator(`${VIEW} .dcp-filter-bar input`).fill('fast');
  await expect(page.locator(`${VIEW} .dcp-vlist__body [role="row"]`)).toHaveCount(1);
  await expect(row(page, 0).locator('mark.dcp-match')).toHaveText('fast');
  await page.locator(`${VIEW} .dcp-filter-bar input`).fill('');
  await expect(page.locator(`${VIEW} .dcp-vlist__body [role="row"]`)).toHaveCount(2);

  // FR-HTTP-04/05: the detail, its Response tab with the JSON tree; Escape closes it, not the panel.
  await row(page, 1).click();
  await expect(page.locator(`${VIEW} .dcp-http-detail`)).toBeVisible();
  await expect(page.locator(`${VIEW} .dcp-http-kv`).first()).toContainText(`${ORIGIN}/api/slow`);
  await page.locator(`${VIEW} .dcp-http-detail [role="tab"]`, { hasText: 'Response' }).click();
  await expect(page.locator(`${VIEW} .dcp-http-detail [role="tree"]`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(`${VIEW} .dcp-http-detail`)).toBeHidden();
  await expect(page.locator(VIEW)).toBeVisible();

  const host = await page.evaluate(() => window.__host);
  expect(host.bubbled).toEqual([]);
});

test('FR-HTTP-06, OPEN-04: Copy as cURL by a real click inside the shadow root reaches the clipboard; the host sees no copy', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await page.route('**/api/items*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(VIEW)).toBeVisible();

  await page.evaluate(() => fetch('/api/items?id=7', { headers: { 'x-trace': "it's" } }).then((r) => r.text()));
  await expect(row(page, 0)).toContainText('200');
  await page.evaluate(() => (window.__host.bubbled = []));

  await row(page, 0).click();
  await page.locator(`${VIEW} .dcp-http-detail button[aria-haspopup="menu"]`).click();
  await page.locator(`${VIEW} .dcp-http-detail [role="menuitem"]`, { hasText: 'Copy as cURL' }).click();

  // The OS clipboard may hand back CRLF (Windows): compare the text, not the line ends.
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText().then((text) => text.replace(/\r\n/g, '\n'))))
    .toBe([`curl --url '${ORIGIN}/api/items?id=7'`, `  -X 'GET'`, `  -H 'x-trace: it'\\''s'`].join(' \\\n'));
  const host = await page.evaluate(() => window.__host);
  expect(host.copies).toBe(0);
  expect(host.bubbled).toEqual([]);
});
