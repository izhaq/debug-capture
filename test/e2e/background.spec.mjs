/**
 * S-13 (release 2.2, HLD §3.11): background control, in a real browser, on the
 * S-10 hosts as HLD §6.6 wires them (the activation piece). The activation
 * chord switches the tool on with nothing loaded before it, remembers it on
 * the browser and turns it off for good (FR-BG-01…03, D-45); the capture
 * chords work with the panel closed and capture off (FR-BG-05…08); the
 * Angular seam finds a session that started after bootstrap (FR-BG-10).
 */
import fs from 'node:fs';
import { expect, test } from '@playwright/test';

const HOSTILE_ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const ACTIVATE = 'Control+Alt+Shift+KeyA';
const PANEL = 'debug-capture-panel-v2';
const VENDOR = '/plain/vendor/debug-capture/';

/** The plain page's own code waits for the activation piece before its first request. */
async function openHost(page, name, query = '') {
  await page.goto(`/${name}/${query}`);
  await page.waitForFunction(() => window.__hostReady === true);
}

/** What the plain page has loaded from the vendored dist/, in order. */
function vendorRequests(page) {
  const seen = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith(VENDOR)) seen.push(pathname.slice(VENDOR.length));
  });
  return seen;
}

/** The plain page's active session, read through the core the activation piece loaded. */
const plainEntries = (page, kind) =>
  page.evaluate(
    async ({ vendor, kind }) => {
      const { getActiveCaptureSession } = await import(`${vendor}index.mjs`);
      const session = getActiveCaptureSession();
      return session === null ? null : session.recorder.snapshot().filter((e) => kind === undefined || e.kind === kind);
    },
    { vendor: VENDOR, kind },
  );

const nativeGlobals = (page) =>
  page.evaluate(() =>
    [window.fetch, XMLHttpRequest.prototype.open, window.WebSocket, console.log].map((f) =>
      Function.prototype.toString.call(f).includes('[native code]'),
    ),
  );

const stored = (page) => page.evaluate(() => localStorage.getItem('debug-capture'));

test('FR-BG-01: before switch-on only activate.mjs loads; the chord loads the rest and starts capture, panel closed', async ({
  page,
}) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const loaded = vendorRequests(page);
  await openHost(page, 'plain');

  expect(loaded).toEqual(['activate.mjs']);
  expect(await page.evaluate((tag) => document.querySelector(tag) !== null, PANEL)).toBe(false);
  expect(await nativeGlobals(page)).toEqual([true, true, true, true]);

  await page.keyboard.press(ACTIVATE);
  await expect.poll(() => page.evaluate((tag) => document.querySelector(tag) !== null, PANEL)).toBe(true);
  expect(loaded).toEqual(expect.arrayContaining(['activate.mjs', 'index.mjs', 'panel.mjs']));
  expect(loaded.some((file) => /^chunks\/app-/.test(file))).toBe(false); // the UI chunk waits for the first open
  expect(await stored(page)).toBe('1');
  expect(await nativeGlobals(page)).toEqual([false, false, false, false]);
  await expect(page.locator(`${PANEL} [role="dialog"]`)).toHaveCount(0);

  await page.evaluate(() => fetch('/api/ping').then((r) => r.json()));
  await expect.poll(async () => (await plainEntries(page, 'http'))?.length).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('FR-BG-02: remembered — after a reload capture starts with the page and records its startup request', async ({
  page,
}) => {
  await openHost(page, 'plain');
  await page.keyboard.press(ACTIVATE);
  await expect.poll(() => stored(page)).toBe('1');

  await page.reload();
  await page.waitForFunction(() => window.__hostReady === true);

  // The page's own first fetch (window.hostDone) ran after debugReady, so capture saw it.
  await page.evaluate(() => window.hostDone);
  await expect
    .poll(async () => (await plainEntries(page, 'http'))?.map((e) => new URL(e.url).pathname))
    .toEqual(['/api/ping']);
});

test('FR-BG-03: the chord again turns it off for good — flag gone, globals native, panel gone', async ({ page }) => {
  await openHost(page, 'plain');
  await page.keyboard.press(ACTIVATE);
  await expect.poll(() => page.evaluate((tag) => document.querySelector(tag) !== null, PANEL)).toBe(true);

  await page.keyboard.press(ACTIVATE);

  await expect.poll(() => page.evaluate((tag) => document.querySelector(tag) !== null, PANEL)).toBe(false);
  expect(await stored(page)).toBeNull();
  expect(await nativeGlobals(page)).toEqual([true, true, true, true]);
  expect(await plainEntries(page)).toBeNull();

  await page.reload();
  await page.waitForFunction(() => window.__hostReady === true);
  expect(await page.evaluate((tag) => document.querySelector(tag) !== null, PANEL)).toBe(false);
});

test('FR-BG-03: on, off, on again in one page — a fresh capture and a working panel', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openHost(page, 'plain');
  const mounted = () => page.evaluate((tag) => document.querySelector(tag) !== null, PANEL);

  await page.keyboard.press(ACTIVATE);
  await expect.poll(mounted).toBe(true);
  await page.evaluate(() => fetch('/api/ping').then((r) => r.json()));
  await expect.poll(async () => (await plainEntries(page, 'http'))?.length).toBe(1);
  await page.keyboard.press(ACTIVATE);
  await expect.poll(mounted).toBe(false);

  await page.keyboard.press(ACTIVATE);
  await expect.poll(mounted).toBe(true);
  expect(await stored(page)).toBe('1');
  // A new, empty buffer; capture works again.
  expect(await plainEntries(page, 'http')).toEqual([]);
  await page.evaluate(() => fetch('/api/ping').then((r) => r.json()));
  await expect.poll(async () => (await plainEntries(page, 'http'))?.length).toBe(1);
  // The second panel opens.
  await page.keyboard.press('Control+Alt+Shift+KeyP');
  await expect(page.locator(`${PANEL} .dcp-frame`)).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('D-45: ?debug=1 never stores the flag, and the chord turns that page off too', async ({ page }) => {
  await openHost(page, 'plain', '?debug=1');
  expect(await stored(page)).toBeNull();
  expect(await nativeGlobals(page)).toEqual([false, false, false, false]);

  await page.keyboard.press(ACTIVATE);

  await expect.poll(() => nativeGlobals(page)).toEqual([true, true, true, true]);
  expect(await stored(page)).toBeNull();
  await page.goto('/plain/');
  await page.waitForFunction(() => window.__hostReady === true);
  expect(await page.evaluate((tag) => document.querySelector(tag) !== null, PANEL)).toBe(false);
});

test('FR-BG-05…08: with the panel closed — capture off and on, and download, copy, note and clear while off', async ({
  page,
  context,
}) => {
  await openHost(page, 'angular');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
  await page.locator('#host-input').focus();
  await page.keyboard.press(ACTIVATE);
  await page.waitForFunction(() => window.__hostSession !== null);
  const on = () => page.evaluate(() => window.__debug.controller.on);
  const kinds = () => page.evaluate(() => window.__hostSession.recorder.snapshot().map((e) => e.kind));
  await page.locator('#host-request').click();
  await expect.poll(async () => (await kinds()).includes('http')).toBe(true);

  // FR-BG-05: Ctrl+Alt+Shift+S turns capture off; the page's requests are not recorded.
  await page.keyboard.press('Control+Alt+Shift+KeyS');
  expect(await on()).toBe(false);
  const before = (await kinds()).length;
  await page.locator('#host-request').click();
  await expect(page.locator('#host-reply')).toHaveText('{"pong":true}');
  expect((await kinds()).length).toBe(before);

  // FR-BG-08 / FR-BG-06: download and copy work while off, panel closed.
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+Alt+Shift+KeyD')]);
  expect(download.suggestedFilename()).toMatch(/^debug-capture-\d{8}-\d{6}\.json$/);
  await page.keyboard.press('Control+Alt+Shift+KeyC');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText().then((text) => JSON.parse(text).schemaVersion)))
    .toBe(2);

  // FR-BG-07: the note chord adds the pre-defined note, also while off.
  await page.keyboard.press('Control+Alt+Shift+KeyM');
  const note = await page.evaluate(() => window.__hostSession.recorder.snapshot().find((e) => e.kind === 'note'));
  expect(note).toEqual(expect.objectContaining({ title: 'Mark', text: 'Added with the keyboard shortcut.' }));

  // Clear while off (Ctrl+Alt+Shift+X), then the record chord turns capture back on.
  await page.keyboard.press('Control+Alt+Shift+KeyX');
  expect(await kinds()).toEqual([]);
  await page.keyboard.press('Control+Alt+Shift+KeyS');
  expect(await on()).toBe(true);
  await page.locator('#host-request').click();
  await expect.poll(async () => (await kinds()).includes('http')).toBe(true);

  // The panel stayed closed the whole time and never took focus.
  await expect(page.locator(`${PANEL} [role="dialog"]`)).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.localName)).toBe('button');
});

test('FR-BG-10: switched on after bootstrap, the Angular ErrorHandler records into the new session', async ({
  page,
}) => {
  await openHost(page, 'angular');
  await page.keyboard.press(ACTIVATE);
  await page.waitForFunction(() => window.__hostSession !== null);

  await page.locator('#host-fail').click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__hostSession.recorder
          .snapshot()
          .filter((e) => e.kind === 'error' && e.source === 'angular')
          .map((e) => e.message),
      ),
    )
    .toEqual(['angular host failure']);
});

test('FR-BG-04, D-41: after the chord nothing shows; Settings › DBG button › Show brings the button back, also after a reload', async ({
  page,
}) => {
  await openHost(page, 'plain');
  await page.keyboard.press(ACTIVATE);
  await expect.poll(() => page.evaluate((tag) => document.querySelector(tag) !== null, PANEL)).toBe(true);
  const launcher = page.locator(`${PANEL} .dcp-launcher`);
  await expect(launcher).toBeHidden();

  await page.keyboard.press('Control+Alt+Shift+KeyP');
  await expect(page.locator(`${PANEL} .dcp-frame`)).toBeVisible();
  await page.locator(`${PANEL} button[aria-label="Settings"]`).click();
  await expect(page.locator(`${PANEL} input[name="dcp-setting-launcher"][value="hide"]`)).toBeChecked();
  await page.locator(`${PANEL} input[name="dcp-setting-launcher"][value="show"]`).check();
  await page.keyboard.press('Control+Alt+Shift+KeyP');
  await expect(launcher).toBeVisible();

  await page.reload();
  await page.waitForFunction(() => window.__hostReady === true);
  await expect(page.locator(`${PANEL} .dcp-launcher`)).toBeVisible();
});

test('FR-BG-09, D-42: Settings › About lists the version and every chord in use, custom ones included', async ({
  page,
}) => {
  await page.goto(`${HOSTILE_ORIGIN}/?nopanel`);
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate(() => window.__dc.install({ shortcut: 'ctrl+alt+shift+9', activation: 'ctrl+alt+shift+q' }));
  await page.locator('#host-input').focus();
  await page.keyboard.press('Control+Alt+Shift+Digit9');
  await expect(page.locator(`${PANEL} .dcp-frame`)).toBeVisible();
  await page.locator(`${PANEL} button[aria-label="Settings"]`).click();

  const about = page.locator(`${PANEL} .dcp-about`);
  await expect(about).toBeVisible();
  await expect(about).toContainText(`debug-capture ${VERSION}`);
  const rows = await about
    .locator('tr')
    .evaluateAll((trs) => trs.map((tr) => Array.from(tr.children).map((td) => td.textContent.trim())));
  expect(rows.slice(0, 7)).toEqual([
    ['Ctrl+Alt+Shift+Q', 'Turn the tool on (remembered); again: off for good'],
    ['Ctrl+Alt+Shift+9', 'Open / close the panel'],
    ['Ctrl+Alt+Shift+D', 'Download the capture (JSON file)'],
    ['Ctrl+Alt+Shift+C', 'Copy the capture (JSON) to the clipboard'],
    ['Ctrl+Alt+Shift+X', 'Clear the capture'],
    ['Ctrl+Alt+Shift+S', 'Capture on / off'],
    ['Ctrl+Alt+Shift+M', 'Add the pre-set note'],
  ]);
  expect(rows.map(([keys]) => keys)).toEqual(expect.arrayContaining(['Escape', 'Ctrl+F', 'Alt+1 / Alt+2']));
  // The list scrolls inside the popover by keyboard too (a focusable region).
  await about.focus();
  await expect(about).toBeFocused();
  const host = await page.evaluate(() => window.__host);
  expect(host.violations).toEqual([]);
});

test('D-41: the DBG button shows on a ?debug=1 page; the chord and the stored flag keep it hidden', async ({
  page,
}) => {
  const launcher = page.locator(`${PANEL} .dcp-launcher`);
  const mounted = () => page.evaluate((tag) => document.querySelector(tag) !== null, PANEL);

  await openHost(page, 'plain');
  await page.keyboard.press(ACTIVATE);
  await expect.poll(mounted).toBe(true);
  await expect(launcher).toBeHidden();

  await openHost(page, 'plain', '?debug=1');
  await expect(launcher).toBeVisible();

  await openHost(page, 'plain');
  await expect.poll(mounted).toBe(true);
  await expect(launcher).toBeHidden();
});
