/**
 * S-07 Console view on the hostile host (strict CSP + Trusted Types, hostile
 * CSS, the real capture controller): the page logs at every level, throws and
 * rejects a promise; each shows with its level and source; the level toggles
 * and the search filter; the detail opens with its argument tree and stack;
 * and using the panel writes nothing to the console and adds no entry
 * (FR-CON-01...04, NFR-REL-01, ISO-12, AGENTS rule 29). A test lists the page
 * errors it makes on purpose; every other error, and any CSP violation, still
 * fails it.
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const TOGGLE = 'Control+Alt+Shift+KeyP';
const PANEL = 'debug-capture-panel-v2';
const VIEW = `${PANEL} .dcp-console`;

let pageErrors;
/** The page errors this test makes on purpose (`null`: none). */
let madeOnPurpose;
const unexpected = (messages) => messages.filter((message) => !madeOnPurpose?.test(message));

test.beforeEach(({ page }) => {
  pageErrors = [];
  madeOnPurpose = null;
  page.on('pageerror', (error) => pageErrors.push(error.message));
});

test.afterEach(async ({ page }) => {
  const host = await page.evaluate(() => window.__host ?? null).catch(() => null);
  if (host) {
    expect(host.violations, 'CSP / Trusted Types violations').toEqual([]);
    expect(unexpected(host.errors), 'window errors and unhandled rejections').toEqual([]);
  }
  expect(unexpected(pageErrors)).toEqual([]);
});

/** The shown rows; the list has no header row, so row `index` (0-based) is `aria-rowindex` index + 1. */
const rows = (page) => page.locator(`${VIEW} .dcp-vlist__body [role="row"]:not([hidden])`);
const row = (page, index) => page.locator(`${VIEW} .dcp-vlist__body [role="row"][aria-rowindex="${index + 1}"]`);
const cell = (page, index, column) => row(page, index).locator('[role="gridcell"]').nth(column);
const level = (page, label) =>
  page.locator(`${VIEW} [role="group"][aria-label="Level"]`).getByRole('button', { name: label, exact: true });
const search = (page) => page.locator(`${VIEW} .dcp-filter-bar input`);
/** Console calls and errors in the capture buffer: the truth the list shows. */
const consoleEntries = (page) =>
  page.evaluate(
    () =>
      window.__dc.controller.session.recorder
        .snapshot()
        .filter((entry) => entry.kind === 'log' || entry.kind === 'error').length,
  );

async function openConsole(page) {
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await page.locator(`${PANEL} [role="tab"]`, { hasText: 'Console' }).click();
  await expect(page.locator(VIEW)).toBeVisible();
}

test('FR-CON-01...04: logs at every level, a throw and a rejection show with level and source; toggles, search and detail work', async ({
  page,
}) => {
  madeOnPurpose = /e2e (thrown|rejected)/;
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  await openConsole(page);
  await expect(page.locator(`${VIEW} .dcp-empty`).first()).toHaveText('No console messages yet.');

  await page.evaluate(() => {
    console.log('e2e log', { id: 7, roles: ['admin'] });
    console.info('e2e info');
    console.warn('e2e warn');
    console.error('e2e error');
    console.debug('e2e debug');
  });
  await expect(rows(page)).toHaveCount(5);
  // FR-CON-01: errors from the page too - a throw in a task, then a rejection nobody handles.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e thrown');
    });
  });
  await expect(rows(page)).toHaveCount(6);
  await page.evaluate(() => {
    void Promise.reject(new Error('e2e rejected'));
  });
  await expect(rows(page)).toHaveCount(7);

  const expected = [
    ['log', '', 'e2e log {"id":7,"roles":["admin"]}'],
    ['info', '', 'e2e info'],
    ['warn', '', 'e2e warn'],
    ['error', '', 'e2e error'],
    ['debug', '', 'e2e debug'],
    ['error', 'window', 'e2e thrown'],
    ['error', 'unhandledrejection', 'e2e rejected'],
  ];
  for (const [index, [levelText, source, message]] of expected.entries()) {
    await expect(cell(page, index, 0)).toHaveText(levelText);
    await expect(cell(page, index, 2)).toHaveText(source);
    await expect(cell(page, index, 3)).toContainText(message);
  }
  await expect(row(page, 2)).toHaveClass(/dcp-row--warn/);
  await expect(row(page, 5)).toHaveClass(/dcp-row--error/);

  await page.evaluate(() => (window.__host.bubbled = []));

  // FR-CON-04: level toggles (errors count as Errors), then the search, which also looks in the source.
  await level(page, 'Errors').click();
  await expect(rows(page)).toHaveCount(3);
  await level(page, 'Warnings').click();
  await expect(rows(page)).toHaveCount(4);
  await search(page).fill('rejection');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 0).locator('mark.dcp-match')).toHaveText('rejection');
  await search(page).fill('');
  await level(page, 'All').click();
  await expect(rows(page)).toHaveCount(7);

  // FR-CON-02/03: the detail shows each argument as a tree, and the stack on click; Escape closes it, not the panel.
  const detail = page.locator(`${VIEW} .dcp-console-detail`);
  await row(page, 0).click();
  await expect(detail).toBeVisible();
  await expect(detail.locator('[role="tree"]')).toHaveCount(2);
  await expect(detail.locator('[role="tree"]').nth(1)).toContainText('admin');
  await row(page, 5).click();
  await detail.getByRole('button', { name: 'Stack' }).click();
  await expect(detail.locator('#dcp-console-stack')).toContainText('e2e thrown');
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(page.locator(VIEW)).toBeVisible();

  const host = await page.evaluate(() => window.__host);
  expect(host.bubbled).toEqual([]);
  expect(host.errors.filter((message) => madeOnPurpose.test(message))).toHaveLength(2);
  // ISO-12: using the panel added no entry of its own.
  expect(await consoleEntries(page)).toBe(7);
});

test('NFR-REL-01, ISO-12: opening and using the Console view writes nothing to the console and adds no entry', async ({
  page,
}) => {
  const logged = [];
  page.on('console', (message) => logged.push(`${message.type()}: ${message.text()}`));
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  // Recorded the way a probe records, without a console call: an error and a log.
  await page.evaluate(() => {
    window.__dc.record(true);
    window.__dc.record(false);
  });
  await openConsole(page);
  await expect(rows(page)).toHaveCount(2);

  await row(page, 0).click();
  await expect(page.locator(`${VIEW} .dcp-console-detail`)).toBeVisible();
  await row(page, 1).click();
  await level(page, 'Errors').click();
  await search(page).fill('nothing matches this');
  await expect(page.locator(`${VIEW} .dcp-empty`, { hasText: 'No entries match the filter.' })).toBeVisible();
  await page.locator(VIEW).getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows(page)).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.keyboard.press(TOGGLE);
  await page.keyboard.press(TOGGLE);
  await page.locator(`${PANEL} [role="tab"]`, { hasText: 'Console' }).click();
  await expect(rows(page)).toHaveCount(2);

  expect(await consoleEntries(page)).toBe(2);
  expect(logged).toEqual([]);
});
