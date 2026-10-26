/**
 * S-14b (release 2.3) on the hostile host (strict CSP + Trusted Types, hostile
 * CSS, the real capture controller): the host's own messages through the panel
 * handle — dropped while capture is off, an `error` one in the badge while the
 * panel is closed, rows and detail in Console, the App chip, and the export
 * (FR-MSG-02…07). Every test also checks that the page saw no CSP violation
 * and no page error.
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

test('FR-MSG-02…07: handle.message() — dropped while off, a problem in the badge, rows, detail, App chip, export', async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => window.__ready === true);

  // FR-MSG-03: capture off drops the message; on again records.
  await page.evaluate(() => {
    const { controller, handle } = window.__dc;
    controller.stop();
    handle.message('while-off', { lost: true });
    controller.start();
    handle.message('order-saved', { id: 42, password: 'hunter2' });
    handle.message('payment-failed', { code: 'E17' }, 'error');
  });

  // FR-MSG-06: the error one is a new problem on the closed panel's badge.
  await expect(page.getByRole('button', { name: 'DBG 1: open debug panel, 1 new problem' })).toBeVisible();

  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(`${PANEL} .dcp-frame`)).toBeVisible();
  await page.locator(`${PANEL} [role="tab"]`, { hasText: 'Console' }).click();
  const rows = page.locator(`${PANEL} .dcp-console .dcp-vlist__body [role="row"]:not([hidden])`);

  // FR-MSG-05: the rows — the word app, the type and the data; secrets redacted (FR-MSG-04).
  const saved = rows.filter({ hasText: 'order-saved' });
  await expect(saved).toHaveCount(1);
  await expect(saved).toContainText('app');
  await expect(saved).toContainText('"password":"[redacted]"');
  await expect(rows.filter({ hasText: 'payment-failed' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'while-off' })).toHaveCount(0);

  // The detail: Type and a Data tree.
  await saved.click();
  const detail = page.locator(`${PANEL} .dcp-console-detail`);
  await expect(detail.locator('.dcp-console-pre').first()).toHaveText('order-saved');
  await expect(detail.locator('[aria-label="Data"]')).toBeVisible();

  // The App chip: only app messages among the chosen chips.
  const levels = page.locator(`${PANEL} .dcp-console [role="group"][aria-label="Level"]`);
  await levels.getByRole('button', { name: 'App' }).click();
  await expect(rows).toHaveCount(2);
  await levels.getByRole('button', { name: 'App' }).click();

  // FR-MSG-07: exported as entries of kind app, schema 2.
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download all (JSON)' }).click(),
  ]);
  const file = JSON.parse(Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8'));
  expect(file.schemaVersion).toBe(2);
  const apps = file.entries.filter((e) => e.kind === 'app');
  expect(apps.map(({ type, level, data }) => ({ type, level, data }))).toEqual([
    { type: 'order-saved', level: 'info', data: { id: 42, password: '[redacted]' } },
    { type: 'payment-failed', level: 'error', data: { code: 'E17' } },
  ]);
  for (const entry of apps) expect(Object.keys(entry).slice(0, 2)).toEqual(['sequence', 'time']);
});
