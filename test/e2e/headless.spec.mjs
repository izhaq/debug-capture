/**
 * S-17a (release 2.5, HLD §3.15): a host with no panel, in a real browser.
 *
 * The headless host (`debug-capture/activate-headless`, D-56) is bundled by
 * esbuild from the built package like an app's own bundle; its output must
 * hold no panel code (FR-HL-02), while capture, the chords and export work
 * (FR-HL-03…05, BR-06). The feature-flag host keeps the panel in its bundle and
 * turns it off at run time from a "backend" flag (FR-HL-08…10, D-57).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOSTILE_ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const ECHO = `${HOSTILE_ORIGIN.replace(/^http/, 'ws')}/ws-echo`;
const PANEL = 'debug-capture-panel-v2';
const ACTIVATE = 'Control+Alt+Shift+KeyA';
const TOGGLE = 'Control+Alt+Shift+KeyP';
const DOWNLOAD = 'Control+Alt+Shift+KeyD';
const COPY = 'Control+Alt+Shift+KeyC';
const RECORD = 'Control+Alt+Shift+KeyS';
/** Panel code in a host bundle: the panel entry, its UI chunk, or anything built from src/panel/. */
const PANEL_INPUT = /^(dist\/panel\.mjs|dist\/chunks\/app-[\w-]+\.mjs|src\/panel\/)/;
/** A request for the panel's files, in the host's own output. */
const PANEL_REQUEST = /\/hosts-out\/[\w-]+\/chunks\/(panel|app)-[\w-]+\.mjs$/;

/** The host's esbuild outputs (test/hosts/build.mjs) and the panel inputs each one holds. */
function hostOutputs(name) {
  const dir = path.join(ROOT, '.test-out', 'hosts', name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  return Object.entries(meta.outputs)
    .filter(([file]) => file.endsWith('.mjs'))
    .map(([file, output]) => ({
      file,
      text: fs.readFileSync(path.join(ROOT, file), 'utf8'),
      panelInputs: Object.keys(output.inputs).filter((input) => PANEL_INPUT.test(input)),
    }));
}

async function openHost(page, name, query = '') {
  await page.goto(`/${name}/${query}`);
  await page.waitForFunction(() => window.__hostReady === true);
}

function requests(page) {
  const seen = [];
  page.on('request', (request) => seen.push(new URL(request.url()).pathname));
  return seen;
}

/** One of each: fetch, XHR, a WebSocket round trip, a console line and an uncaught error. */
async function makeTraffic(page) {
  await page.evaluate(async () => {
    await fetch('/api/ping?via=fetch').then((r) => r.json());
    await new Promise((done) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/ping?via=xhr');
      xhr.addEventListener('loadend', () => done());
      xhr.send();
    });
  });
  await page.evaluate(
    (url) =>
      new Promise((done) => {
        const socket = new WebSocket(url);
        socket.addEventListener('open', () => socket.send('headless hello'));
        socket.addEventListener('message', () => {
          socket.close();
          done();
        });
      }),
    ECHO,
  );
  await page.evaluate(() => {
    console.warn('headless warning');
    setTimeout(() => {
      throw new Error('headless failure');
    });
  });
}

/** Presses a chord and reports whether anything on the page called preventDefault() on it. */
const pressAndSeeIfTaken = async (page, keys) => {
  await page.evaluate(() => {
    window.__taken = null;
    window.addEventListener('keydown', (e) => (window.__taken = e.defaultPrevented), { once: true });
  });
  await page.keyboard.press(keys);
  return page.evaluate(() => window.__taken);
};

const exported = (file) => {
  const kinds = new Set(file.entries.map((e) => e.kind));
  const urls = file.entries.filter((e) => e.kind === 'http').map((e) => `${e.transport} ${e.url}`);
  return { kinds, urls };
};

test('FR-HL-02: the headless host bundle holds no panel code; a with-panel host does (control)', () => {
  const headless = hostOutputs('headless');
  expect(headless.length).toBeGreaterThan(0);
  for (const output of headless) {
    expect(output.panelInputs, output.file).toEqual([]);
    expect(output.text.includes(PANEL), output.file).toBe(false);
  }
  // The same check finds the panel where it is: the feature-flag host imports debug-capture/activate.
  const withPanel = hostOutputs('flag');
  expect(withPanel.some((o) => o.panelInputs.length > 0)).toBe(true);
  expect(withPanel.some((o) => o.text.includes(PANEL))).toBe(true);
});

test('FR-HL-03…05, BR-06: headless on ?debug=1 — records everything, the chords save and copy, nothing to see', async ({
  page,
  context,
}) => {
  const seen = requests(page);
  await openHost(page, 'headless', '?debug=1');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
  expect(await page.evaluate(() => window.__debug.panel)).toBeNull();

  await makeTraffic(page);
  await expect
    .poll(() => page.evaluate(() => window.__debug.session.recorder.snapshot().some((e) => e.kind === 'error')))
    .toBe(true);

  // FR-HL-04: the download chord saves one file with every kind, panel or not.
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(DOWNLOAD)]);
  expect(download.suggestedFilename()).toMatch(/^debug-capture-\d{8}-\d{6}\.json$/);
  const file = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(file.schemaVersion).toBe(2);
  const { kinds, urls } = exported(file);
  for (const kind of ['http', 'ws', 'log', 'error']) expect(kinds.has(kind), kind).toBe(true);
  expect(urls).toEqual(
    expect.arrayContaining([expect.stringMatching(/^fetch .*via=fetch$/), expect.stringMatching(/^xhr .*via=xhr$/)]),
  );
  expect(file.entries.some((e) => e.kind === 'log' && JSON.stringify(e.args).includes('headless warning'))).toBe(true);
  expect(file.entries.some((e) => e.kind === 'error' && e.message.includes('headless failure'))).toBe(true);

  // The copy chord puts the same capture on the clipboard.
  await page.keyboard.press(COPY);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText().then((t) => JSON.parse(t).entries.length)))
    .toBeGreaterThanOrEqual(file.entries.length);

  // FR-HL-05: no element, and the panel chord is nobody's — the page gets it untouched.
  expect(await pressAndSeeIfTaken(page, TOGGLE)).toBe(false);
  expect(await page.locator(PANEL).count()).toBe(0);
  expect(seen.filter((p) => PANEL_REQUEST.test(p))).toEqual([]);
});

test('FR-HL-03, FR-BG-05: headless — the record chord stops and starts capture', async ({ page }) => {
  await openHost(page, 'headless', '?debug=1');
  const count = (via) =>
    page.evaluate(
      (via) =>
        window.__debug.session.recorder.snapshot().filter((e) => e.kind === 'http' && e.url.endsWith(via)).length,
      via,
    );
  await page.keyboard.press(RECORD);
  expect(await page.evaluate(() => window.__debug.controller.on)).toBe(false);
  await page.evaluate(() => fetch('/api/ping?via=off'));
  await page.keyboard.press(RECORD);
  expect(await page.evaluate(() => window.__debug.controller.on)).toBe(true);
  await page.evaluate(() => fetch('/api/ping?via=on'));
  await expect.poll(() => count('via=on')).toBe(1);
  expect(await count('via=off')).toBe(0);
});

test('FR-HL-03: headless — nothing but the host loads before the chord; the chord loads the core only, and turns it off again', async ({
  page,
}) => {
  const seen = requests(page);
  await openHost(page, 'headless');
  expect(await page.evaluate(() => window.__debug.active)).toBe(false);
  const scripts = () => seen.filter((p) => p.endsWith('.mjs'));
  expect(scripts()).toEqual(['/hosts-out/headless/main.mjs']);

  await page.keyboard.press(ACTIVATE);
  await expect.poll(() => page.evaluate(() => window.__debug.session !== null)).toBe(true);
  expect(scripts()).toHaveLength(2); // + the core chunk
  expect(seen.filter((p) => PANEL_REQUEST.test(p))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('debug-capture'))).toBe('1');

  await page.keyboard.press(ACTIVATE);
  expect(await page.evaluate(() => window.__debug.active)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('debug-capture'))).toBeNull();
  expect(await page.locator(PANEL).count()).toBe(0);
});

test('FR-HL-08…09: a backend flag says no — capture starts before it answers, the panel is never fetched or shown', async ({
  page,
}) => {
  const seen = requests(page);
  await openHost(page, 'flag', '?debug=1&panel=off');
  // FR-HL-09: ready came before the 50 ms "backend" answer; capture is already on.
  expect(await page.evaluate(() => window.__debug.controller?.on)).toBe(true);
  await page.waitForTimeout(200);

  await page.evaluate(() => fetch('/api/ping?via=flag'));
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(DOWNLOAD)]);
  const file = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(file.entries.some((e) => e.kind === 'http' && e.url.endsWith('via=flag'))).toBe(true);

  expect(await page.evaluate(() => [window.__debug.panel, window.__debug.panelError])).toEqual([null, null]);
  expect(await pressAndSeeIfTaken(page, TOGGLE)).toBe(false);
  expect(await page.locator(PANEL).count()).toBe(0);
  expect(seen.filter((p) => PANEL_REQUEST.test(p))).toEqual([]);
});

test('FR-HL-08: the backend flag says yes — the panel comes after the answer and opens with its chord', async ({
  page,
}) => {
  await openHost(page, 'flag', '?debug=1&panel=on');
  await expect.poll(() => page.evaluate(() => window.__debug.panel !== null)).toBe(true);
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(`${PANEL}`)).toHaveCount(1);
  await expect.poll(() => page.evaluate((tag) => document.activeElement?.localName === tag, PANEL)).toBe(true);
});
