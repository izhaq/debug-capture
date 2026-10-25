/**
 * NFR-SEC-01…04 final pass (S10-13), on the hostile host (strict CSP +
 * Trusted Types, the real capture controller). The earlier specs prove each
 * rule where it is built (the safe builder, each view's detail, the cURL
 * quoting, copy and export); this file checks them once more on the whole
 * open panel:
 *   - HTML and `javascript:` in captured data render as text in every view
 *     and its detail; no element, link or image comes from it (SEC-01);
 *   - no CSP or Trusted Types violation while doing so (SEC-02, afterEach);
 *   - the open panel, used, makes no network request (SEC-03);
 *   - nothing is copied or downloaded until the user clicks Copy / Download
 *     (SEC-04).
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const TOGGLE = 'Control+Alt+Shift+KeyP';
const PANEL = 'debug-capture-panel-v2';
const EVIL = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
const LINK = 'javascript:window.__pwned=3';

let pageErrors;

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // Count every copy and every download the page makes (SEC-04).
  await page.addInitScript(() => {
    window.__out = { clipboard: 0, blobs: 0 };
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      window.__out.blobs++;
      return createObjectURL(blob);
    };
    if (navigator.clipboard) {
      const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text) => {
        window.__out.clipboard++;
        return writeText(text);
      };
    }
  });
});

test.afterEach(async ({ page }) => {
  const host = await page.evaluate(() => window.__host ?? null).catch(() => null);
  if (host) {
    expect(host.violations, 'CSP / Trusted Types violations').toEqual([]);
    expect(host.errors, 'window errors and unhandled rejections').toEqual([]);
  }
  expect(pageErrors).toEqual([]);
});

/** Records one hostile HTTP request, WebSocket message, log and error, as the probes would store them. */
function recordHostile(page) {
  return page.evaluate(
    ([evil, link]) => {
      const { recorder, clock } = window.__dc.controller.session;
      const t = clock.now();
      recorder.record({
        kind: 'http',
        t,
        transport: 'fetch',
        method: 'POST',
        url: `${location.origin}/api/${evil}?next=${link}`,
        status: 200,
        durationMs: 5,
        reqHeaders: { 'x-evil': evil },
        resHeaders: { 'content-type': 'text/html', location: link },
        reqBody: evil,
        resBody: `<!doctype html><a href="${link}">click</a>${evil}`,
        bytes: 100,
        error: null,
      });
      recorder.record({
        kind: 'ws',
        t,
        socketId: 1,
        url: `wss://app.test/${link}`,
        event: 'receive',
        opcode: 'text',
        bytes: 10,
        data: evil,
        code: null,
      });
      recorder.record({ kind: 'log', t, level: 'log', args: [evil, { href: link, html: evil }] });
      recorder.record({ kind: 'error', t, source: 'window', message: evil, stack: `Error: ${evil}\n    at ${link}` });
    },
    [EVIL, LINK],
  );
}

/** What the shadow root holds that captured data must never create. */
const injected = (page) =>
  page.evaluate((tag) => {
    const root = document.querySelector(tag).shadowRoot;
    return {
      pwned: window.__pwned ?? null,
      elements: root.querySelectorAll('img, script, a, iframe, object, embed, [href], [src], [onerror]').length,
    };
  }, PANEL);

async function openPanel(page) {
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  await recordHostile(page);
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(`${PANEL} .dcp-http`)).toBeVisible();
}

test('NFR-SEC-01/02: HTML and javascript: in captured data stay text in every view and detail', async ({ page }) => {
  await openPanel(page);
  const panel = page.locator(PANEL);

  // HTTP: the row, then each detail tab.
  const httpRow = page.locator(`${PANEL} .dcp-http .dcp-vlist__body [role="row"]`).first();
  // The Name column shows the URL's last segment: `script>?next=javascript:…`, as text.
  await expect(httpRow).toContainText('script>?next=javascript:window.__pwned=3');
  await httpRow.click();
  for (const tab of ['Headers', 'Payload', 'Response']) {
    await page.locator(`${PANEL} .dcp-http-detail [role="tab"]`, { hasText: tab }).click();
  }
  await expect(page.locator(`${PANEL} .dcp-http-detail`)).toContainText('<a href="javascript:');
  expect(await injected(page)).toEqual({ pwned: null, elements: 0 });

  // WebSocket: the message and its detail.
  await page.locator(`${PANEL} #dcp-subtab-ws`).click();
  const wsRow = page.locator(`${PANEL} .dcp-ws .dcp-list-pane .dcp-vlist__body [role="row"]`).first();
  await expect(wsRow).toContainText('<img src=x');
  await wsRow.click();
  await expect(page.locator(`${PANEL} .dcp-ws-detail`)).toContainText('<script>');
  expect(await injected(page)).toEqual({ pwned: null, elements: 0 });

  // Console: the log and the error, each with its detail (the error's stack too).
  await page.keyboard.press('Alt+Digit2');
  const consoleRows = page.locator(`${PANEL} .dcp-console .dcp-vlist__body [role="row"]`);
  await expect(consoleRows).toHaveCount(2);
  for (const index of [0, 1]) {
    await consoleRows.nth(index).click();
    await expect(page.locator(`${PANEL} .dcp-console-detail`)).toContainText('<img src=x');
  }
  await page.locator(`${PANEL} .dcp-console-detail`).getByRole('button', { name: 'Stack' }).click();
  await expect(page.locator(`${PANEL} .dcp-console-detail`)).toContainText('at javascript:');
  expect(await injected(page)).toEqual({ pwned: null, elements: 0 });
  await expect(panel).toBeAttached();
});

test('NFR-SEC-03: the open panel, used in every view, makes no network request', async ({ page }) => {
  await openPanel(page);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.locator(`${PANEL} .dcp-http .dcp-vlist__body [role="row"]`).first().click();
  await page.locator(`${PANEL} .dcp-http-detail [role="tab"]`, { hasText: 'Response' }).click();
  await page.locator(`${PANEL} .dcp-http input[aria-label="Filter requests"]`).fill('api');
  await page.locator(`${PANEL} .dcp-http [role="columnheader"]`, { hasText: 'Status' }).locator('button').click();
  await page.locator(`${PANEL} #dcp-subtab-ws`).click();
  await page.locator(`${PANEL} .dcp-ws .dcp-list-pane .dcp-vlist__body [role="row"]`).first().click();
  await page.keyboard.press('Alt+Digit2');
  await page.locator(`${PANEL} .dcp-console .dcp-vlist__body [role="row"]`).first().click();
  await page.locator(`${PANEL} button[aria-label="Settings"]`).click();
  await page.keyboard.press('Escape');
  await page.locator(`${PANEL} button[aria-label="Export"]`).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Maximize panel' }).click();
  await page.waitForTimeout(200);

  expect(requests).toEqual([]);
});

test('NFR-SEC-04: nothing is copied or downloaded until the user clicks Copy or Download', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await openPanel(page);
  const out = () => page.evaluate(() => ({ ...window.__out }));

  // Every view and detail opened, the menus opened and closed: nothing leaves the page.
  await page.locator(`${PANEL} .dcp-http .dcp-vlist__body [role="row"]`).first().click();
  await page.locator(`${PANEL} .dcp-http-detail button[aria-haspopup="menu"]`).click();
  await page.keyboard.press('Escape');
  await page.locator(`${PANEL} button[aria-label="Export"]`).click();
  await page.keyboard.press('Escape');
  await page.locator(`${PANEL} #dcp-subtab-ws`).click();
  await page.keyboard.press('Alt+Digit2');
  expect(await out()).toEqual({ clipboard: 0, blobs: 0 });

  // Copy all: one clipboard write, no download.
  await page.locator(`${PANEL} button[aria-label="Export"]`).click();
  await page.locator(`${PANEL} [role="menuitem"]`, { hasText: 'Copy all (JSON)' }).click();
  await expect.poll(out).toEqual({ clipboard: 1, blobs: 0 });

  // Download all: one file.
  await page.locator(`${PANEL} button[aria-label="Export"]`).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(`${PANEL} [role="menuitem"]`, { hasText: 'Download all (JSON)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  expect(await out()).toEqual({ clipboard: 1, blobs: 1 });
});
