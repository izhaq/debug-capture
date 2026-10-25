/**
 * S-11b (release 2.1) on the hostile host (strict CSP + Trusted Types, hostile
 * CSS, the real capture controller): the Buffer setting and No limit, the
 * near-full and memory banners, "Show DBG button" across a reload, notes in
 * Console and in the export, and the host's status observer while the panel
 * is closed (FR-BUF-01…05, FR-ACT-10, FR-NOTE-01…04, FR-STAT-01). Every test
 * also checks that the page saw no CSP violation and no page error.
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const TOGGLE = 'Control+Alt+Shift+KeyP';
const PANEL = 'debug-capture-panel-v2';
const MB = 1_048_576;

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

/** The hostile host; `options` installs the panel with them (`?nopanel` + `__dc.install`). */
async function load(page, options = null) {
  await page.goto(ORIGIN + (options ? '/?nopanel' : '/'));
  await page.waitForFunction(() => window.__ready === true);
  if (options) await page.evaluate((o) => window.__dc.install(o), options);
}

async function open(page) {
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(`${PANEL} .dcp-frame`)).toBeVisible();
}

/** `n` log entries, each with `chars` characters of text. */
const record = (page, n, chars = 5) =>
  page.evaluate(
    ([count, size]) => {
      const recorder = window.__dc.controller.session.recorder;
      const text = 'x'.repeat(size);
      for (let i = 0; i < count; i++) recorder.record({ kind: 'log', t: Date.now(), level: 'log', args: [text] });
    },
    [n, chars],
  );

const usage = (page) => page.evaluate(() => window.__dc.controller.session.recorder.usage());
const statusBar = (page) => page.locator(`${PANEL} .dcp-statusbar`);
const banner = (page, kind) => page.locator(`${PANEL} .dcp-banner[data-warning="${kind}"]`);
const settings = (page) => page.locator(`${PANEL} .dcp-pop[aria-label="Settings"]`);

test('FR-BUF-01/02/03: Buffer in Settings — live, kept across a reload before the first open; No limit warns', async ({
  page,
}) => {
  await load(page);
  await record(page, 1200);
  await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await settings(page).getByRole('radio', { name: '1,000' }).check();
  await expect(statusBar(page)).toContainText('buffer 1,000 / 1,000');
  expect((await usage(page)).capacity).toBe(1000);

  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  expect((await usage(page)).capacity, 'applied by the loader, before any open').toBe(1000);

  await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(settings(page).getByRole('radio', { name: '1,000' })).toBeChecked();
  const warning = settings(page).locator('.dcp-setting-note');
  await expect(warning).toBeHidden();
  await settings(page).getByRole('radio', { name: 'No limit' }).check();
  await expect(warning).toBeVisible();
  await expect(warning).toHaveText('No limit: the page may get slow and use a lot of memory. Use it at your own risk.');
  await record(page, 1500);
  await expect(statusBar(page)).toContainText(/buffer [\d,]+ \/ no limit/);
  expect((await usage(page)).capacity).toBe(Infinity);
  expect((await usage(page)).entries).toBeGreaterThan(1000);
});

test('FR-BUF-04: near-full banner — Download all, Raise the limit, Dismiss; back after Clear', async ({ page }) => {
  await load(page, { nearFullAt: 0.5 });
  await page.evaluate(() => window.__dc.controller.session.recorder.setCapacity(1000));
  await open(page);
  await expect(banner(page, 'nearFull')).toBeHidden();

  await record(page, 600);
  await expect(banner(page, 'nearFull')).toBeVisible();
  await expect(banner(page, 'nearFull')).toContainText(
    /The buffer is almost full \([\d,]+ \/ 1,000\)\. The oldest entries will soon be dropped\./,
  );

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    banner(page, 'nearFull').getByRole('button', { name: 'Download all' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^debug-capture-\d{8}-\d{6}\.json$/);

  await banner(page, 'nearFull').getByRole('button', { name: 'Raise the limit' }).click();
  await expect(settings(page)).toBeVisible();
  await expect(settings(page).getByRole('radio', { name: '1,000' })).toBeFocused();
  await page.keyboard.press('Escape');

  await banner(page, 'nearFull').getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner(page, 'nearFull')).toBeHidden();
  await record(page, 300);
  await page.keyboard.press(TOGGLE);
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(`${PANEL} .dcp-frame`)).toBeVisible();
  await expect(banner(page, 'nearFull'), 'once per crossing, also across close and open').toBeHidden();

  await page.getByRole('button', { name: 'Clear' }).click();
  await record(page, 600);
  await expect(banner(page, 'nearFull'), 'Clear re-arms it').toBeVisible();
});

test('FR-BUF-05: memory banner at each step of the estimate; Dismiss waits for the next step', async ({ page }) => {
  await load(page, { memoryStep: MB });
  await open(page);
  await record(page, 20, 30_000); // ~1.2 MB by the C-9 estimate
  await expect(banner(page, 'memory')).toBeVisible();
  await expect(banner(page, 'memory')).toContainText('Captured data uses about 1 MB. The page may get slow.');
  await banner(page, 'memory').getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner(page, 'memory')).toBeHidden();
  await record(page, 5, 30_000);
  await expect(banner(page, 'memory'), 'still in the same step').toBeHidden();
  await record(page, 20, 30_000);
  await expect(banner(page, 'memory'), 'the next step').toBeVisible();
  expect((await usage(page)).bytes).toBeGreaterThan(2 * MB);
});

test('FR-ACT-10: "Show DBG button" hides the launcher, also after a reload; code launcher: false hides the switch', async ({
  page,
}) => {
  await load(page);
  const launcher = page.locator(`${PANEL} .dcp-launcher`);
  await expect(launcher).toBeVisible();
  await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await settings(page).getByRole('radio', { name: 'Hide' }).check();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator(`${PANEL} .dcp-frame`)).toBeHidden();
  await expect(launcher).toBeHidden();

  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await expect(launcher).toBeHidden();
  await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await settings(page).getByRole('radio', { name: 'Show' }).check();
  await page.keyboard.press(TOGGLE);
  await expect(launcher).toBeVisible();

  await page.goto(ORIGIN + '/?launcher=0');
  await page.waitForFunction(() => window.__ready === true);
  await expect(launcher).toHaveCount(0);
  await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(settings(page).getByRole('radio', { name: 'Hide' })).toHaveCount(0);
});

test('FR-NOTE-01…04: Add note and session.addNote — rows in Console, entries in the export', async ({ page }) => {
  await load(page);
  await page.evaluate(() => window.__dc.controller.session.addNote('From code', 'the host wrote this'));
  await open(page);
  await page.getByRole('button', { name: 'Note' }).click();
  const form = page.locator(`${PANEL} .dcp-pop[aria-label="Add note"]`);
  await expect(form.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await form.getByRole('textbox', { name: 'Title' }).fill('Login');
  await form.getByRole('textbox', { name: 'Text' }).fill('clicked Sign in');
  await form.getByRole('button', { name: 'Add note' }).click();
  await expect(form).toBeHidden();

  await page.locator(`${PANEL} [role="tab"]`, { hasText: 'Console' }).click();
  const rows = page.locator(`${PANEL} .dcp-console .dcp-vlist__body [role="row"]:not([hidden])`);
  await expect(rows.filter({ hasText: 'From code — the host wrote this' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Login — clicked Sign in' })).toHaveCount(1);
  await page
    .locator(`${PANEL} .dcp-console [role="group"][aria-label="Level"]`)
    .getByRole('button', { name: 'Errors' })
    .click();
  await expect(rows.filter({ hasText: 'Login — clicked Sign in' }), 'level chips never hide a note').toHaveCount(1);

  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download all (JSON)' }).click(),
  ]);
  const file = JSON.parse(Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8'));
  expect(file.schemaVersion).toBe(1);
  const notes = file.entries.filter((e) => e.kind === 'note').map((e) => [e.title, e.text]);
  expect(notes).toEqual([
    ['From code', 'the host wrote this'],
    ['Login', 'clicked Sign in'],
  ]);
});

test('FR-STAT-01: onStatus reports while the panel is closed and its UI not loaded; then open / closed', async ({
  page,
}) => {
  await load(page);
  await page.evaluate(() => {
    window.__statuses = [];
    window.__dc.handle.onStatus((s) => window.__statuses.push(s));
  });
  await record(page, 30);
  await page.waitForFunction(() => window.__statuses.some((s) => s.entries >= 30));
  const closed = await page.evaluate(() => window.__statuses[window.__statuses.length - 1]);
  expect(closed).toEqual(
    expect.objectContaining({ open: false, capture: true, capacity: 5000, nearFull: false, memoryStep: 0 }),
  );
  expect(closed.bytes).toBeGreaterThan(30 * 160);
  expect(await page.locator(`${PANEL} .dcp-frame`).count(), 'the UI chunk is still not mounted').toBe(0);

  await open(page);
  await page.waitForFunction(() => window.__statuses[window.__statuses.length - 1].open === true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__statuses[window.__statuses.length - 1].open === false);
});
