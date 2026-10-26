/**
 * NFR-PORT-01, BR-03 (S-10a): the same behaviour in an Angular 16 host, a
 * React 19 host and a plain HTML page. Each host installs capture and the
 * panel exactly as HLD §6.6 shows, from what ships: the Angular and React
 * hosts are bundled from dist/ through package.json `exports`
 * (test/hosts/build.mjs); the plain page imports a vendored copy of dist/.
 *
 * One scenario runs on every host (S10-05): the launcher shows and the UI
 * chunk waits for the first open; the chord opens the panel with focus
 * inside; the host's own request, a WebSocket, a console warning and the
 * framework's error path all show live; Export saves one JSON file holding
 * them; Escape closes and focus returns. With the flag off (S10-06) nothing
 * is installed and the page's globals stay native (BR-02, BR-07).
 */
import { expect, test } from '@playwright/test';

const HOSTILE_ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
/** The hostile server's echo; WebSocket has no CORS, so any page may use it. */
const ECHO = `${HOSTILE_ORIGIN.replace(/^http/, 'ws')}/ws-echo`;
const TOGGLE = 'Control+Alt+Shift+KeyP';
const PANEL = 'debug-capture-panel-v2';
const UI_CHUNK = /\/chunks\/app-[\w-]+\.mjs$/;

/**
 * Per host: the error its framework path records (`#host-fail`), and the page
 * errors Playwright sees. Angular's zone and React's error boundary catch
 * theirs; on the plain page the throw is uncaught, which is what the
 * window error probe records.
 */
const HOSTS = {
  angular: { framework: 'Angular 16 host', failure: 'angular host failure', source: 'angular', pageErrors: [] },
  react: { framework: 'React 19 host', failure: 'react host failure', source: 'react', pageErrors: [] },
  plain: {
    framework: 'Plain page',
    failure: 'plain host failure',
    source: 'window',
    pageErrors: ['plain host failure'],
  },
};

let pageErrors;
let uiChunkRequests;

test.beforeEach(({ page }) => {
  pageErrors = [];
  uiChunkRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (UI_CHUNK.test(new URL(request.url()).pathname)) uiChunkRequests.push(request.url());
  });
});

async function openHost(page, name, query) {
  await page.goto(`/${name}/${query}`);
  await page.waitForFunction(() => window.__hostReady === true);
  await expect(page.locator('#framework')).toContainText(HOSTS[name].framework);
}

for (const [name, host] of Object.entries(HOSTS)) {
  test(`NFR-PORT-01 ${name}: installed as §6.6 shows, the panel shows live HTTP, WebSocket and console, exports, and closes`, async ({
    page,
  }) => {
    await openHost(page, name, '?debug=1');
    const view = (section) => page.locator(`${PANEL} .dcp-${section}`);

    // FR-ACT-02/03: the loader is there; the UI chunk is not loaded yet. 2.2 (D-41): the activation
    // piece starts the DBG button hidden — no visible sign until Settings says Show.
    await page.waitForFunction((tag) => document.querySelector(tag) !== null, PANEL);
    await expect(page.locator(`${PANEL} .dcp-launcher`)).toBeHidden();
    expect(uiChunkRequests).toEqual([]);

    // FR-ACT-05/07: the chord opens the panel and moves focus in; the chunk loads once.
    await page.locator('#host-input').focus();
    await page.keyboard.press(TOGGLE);
    await expect(view('http')).toBeVisible();
    expect(await page.evaluate((tag) => document.activeElement?.localName === tag, PANEL)).toBe(true);
    expect(uiChunkRequests).toHaveLength(1);

    // The host's own request, through its framework's usual path.
    await page.locator('#host-request').click();
    await expect(page.locator('#host-reply')).toHaveText('{"pong":true}');
    const httpRow = view('http').locator('.dcp-vlist__body [role="row"]', { hasText: 'ping' }).last();
    await expect(httpRow).toContainText('GET');
    await expect(httpRow).toContainText('200');

    // A WebSocket and a console warning, made by the page.
    await page.evaluate(
      (url) =>
        new Promise((done) => {
          const socket = new WebSocket(url);
          socket.addEventListener('open', () => socket.send('host hello'));
          socket.addEventListener('message', () => done());
        }),
      ECHO,
    );
    await page.evaluate(() => console.warn('host warning'));
    await page.locator('#host-fail').click();

    await page.locator(`${PANEL} #dcp-subtab-ws`).click();
    await expect(view('ws').locator('.dcp-ws-conns [role="row"]:not([hidden])', { hasText: ECHO })).toBeVisible();

    await page.keyboard.press('Alt+Digit2');
    const consoleRows = view('console').locator('.dcp-vlist__body [role="row"]');
    await expect(consoleRows.filter({ hasText: 'host warning' })).toHaveCount(1);
    await expect(consoleRows.filter({ hasText: host.failure }).filter({ hasText: host.source }).first()).toBeVisible();

    // BR-06: Export › Download all (JSON) saves one file that holds what the panel showed.
    await page.locator(`${PANEL} button[aria-label="Export"]`).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(`${PANEL} [role="menuitem"]`, { hasText: 'Download all (JSON)' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^debug-capture-\d{8}-\d{6}\.json$/);
    const file = JSON.parse(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c)));
    expect(file.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'http', url: expect.stringMatching(/\/api\/ping$/), status: 200 }),
        expect.objectContaining({ kind: 'ws', url: ECHO }),
        expect.objectContaining({ kind: 'log', level: 'warn', args: ['host warning'] }),
        expect.objectContaining({ kind: 'error', source: host.source, message: expect.stringContaining(host.failure) }),
      ]),
    );

    // FR-WIN-05, FR-ACT-07: Escape closes the panel; focus returns to the host control.
    await page.locator(`${PANEL} button[aria-label="Export"]`).focus();
    await page.keyboard.press('Escape');
    await expect(view('console')).toBeHidden();
    await expect(page.locator('#host-input')).toBeFocused();
    expect(pageErrors).toEqual(host.pageErrors);
  });

  test(`BR-02, BR-07 ${name}: with the flag off nothing is installed and the page's globals stay native`, async ({
    page,
  }) => {
    await openHost(page, name, '');
    expect(await page.evaluate(() => window.__hostSession)).toBeNull();
    expect(await page.evaluate((tag) => document.querySelector(tag) !== null, PANEL)).toBe(false);
    await expect(page.getByRole('button', { name: /open debug panel/ })).toHaveCount(0);
    await page.locator('#host-input').focus();
    await page.keyboard.press(TOGGLE);
    await page.locator('#host-request').click();
    await expect(page.locator('#host-reply')).toHaveText('{"pong":true}');
    expect(await page.evaluate((tag) => document.querySelector(tag) !== null, PANEL)).toBe(false);
    expect(uiChunkRequests).toEqual([]);
    // Zone.js (Angular) patches these and makes its own patches read as native, so
    // on the Angular host this only says capture did not patch over the zone.
    expect(
      await page.evaluate(() =>
        [window.fetch, XMLHttpRequest.prototype.open, window.WebSocket, console.log, console.warn].map((f) =>
          Function.prototype.toString.call(f).includes('[native code]'),
        ),
      ),
    ).toEqual([true, true, true, true, true]);
    expect(pageErrors).toEqual([]);
  });
}
