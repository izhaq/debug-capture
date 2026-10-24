/**
 * S-09 on the hostile host (FR-COM-05, NFR-A11Y-01, §4.12, §5.7): one keyboard
 * walk of the real panel, then forced colours and reduced motion on the same
 * page. No mouse. Every test also checks that the page saw no CSP violation
 * and no page error.
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const TOGGLE = 'Control+Alt+Shift+KeyP';
const PANEL = 'debug-capture-panel-v2';
const VIEW = `${PANEL} .dcp-http`;

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

/** Tab until `locator` is the focused element inside its shadow root. */
async function tabTo(page, locator, label) {
  for (let i = 0; i < 40; i += 1) {
    const reached = await locator.evaluate((el) => el.getRootNode().activeElement === el).catch(() => false);
    if (reached) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${label}`);
}

const selectedRow = (page) => page.locator(`${VIEW} .dcp-vlist__body [role="row"][aria-selected="true"]`);

test('FR-COM-05, ISO-07, ISO-16: the panel is fully usable from the keyboard, and keys stay inside it', async ({
  page,
}) => {
  await page.route('**/api/slow', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true,"items":[1,2]}' }),
  );
  await page.route('**/api/fast?q=1', (route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' }),
  );

  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);

  // Ctrl+F outside the panel belongs to the page (S09-01).
  await page.locator('#host-input').focus();
  await page.keyboard.press('Control+KeyF');
  await expect(page.locator('#host-input')).toBeFocused();

  await page.keyboard.press(TOGGLE);
  await expect(page.locator(VIEW)).toBeVisible();
  const focusIn = await page.evaluate(() => {
    const host = document.querySelector('debug-capture-panel-v2');
    const root = host.shadowRoot.querySelector('.dcp-root');
    return root.contains(host.shadowRoot.activeElement);
  });
  expect(focusIn, 'opening moves focus into the panel').toBe(true);

  await page.evaluate(() => {
    fetch('/api/slow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' }).catch(
      () => undefined,
    );
    // Start order: the slow request first, the 404 after it (same as the HTTP e2e).
    setTimeout(() => fetch('/api/fast?q=1').catch(() => undefined), 20);
  });
  await expect(page.locator(`${VIEW} .dcp-vlist__body [role="row"][aria-rowindex="2"]`)).toContainText('slow');
  await expect(page.locator(`${VIEW} .dcp-vlist__body [role="row"][aria-rowindex="3"]`)).toContainText('404');

  await page.evaluate(() => {
    window.__host.bubbled = [];
    window.__host.hotkeys = [];
  });

  // Focus order: resize handle, then the section tabs (§5.3, §4.12).
  await page.keyboard.press('Tab');
  await expect(page.locator(`${PANEL} [role="separator"][aria-label="Resize panel"]`)).toBeFocused();
  await page.keyboard.press('Tab');
  const section = page.locator(
    `${PANEL} [role="tablist"][aria-label="Panel sections"] [role="tab"][aria-selected="true"]`,
  );
  await expect(section).toBeFocused();
  await expect(section).toHaveText('Network');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`${PANEL} .dcp-console`)).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator(VIEW)).toBeVisible();

  await page.keyboard.press('Alt+Digit2');
  await expect(page.locator(`${PANEL} .dcp-console`)).toBeVisible();
  await page.keyboard.press('Alt+Digit1');
  await expect(page.locator(VIEW)).toBeVisible();

  const sub = page.locator(`${PANEL} [role="tablist"][aria-label="Network"] [role="tab"][aria-selected="true"]`);
  await tabTo(page, sub, 'Network sub-tab');
  await expect(sub).toHaveText('HTTP');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`${PANEL} .dcp-ws`)).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator(VIEW)).toBeVisible();

  await tabTo(page, page.locator(`${VIEW} .dcp-vlist`), 'request list');
  await page.keyboard.press('ArrowDown');
  await expect(selectedRow(page)).toHaveAttribute('aria-rowindex', '2');
  await page.keyboard.press('ArrowDown');
  await expect(selectedRow(page)).toHaveAttribute('aria-rowindex', '3');
  await page.keyboard.press('ArrowUp');
  await expect(selectedRow(page)).toHaveAttribute('aria-rowindex', '2');
  await page.keyboard.press('End');
  await expect(selectedRow(page)).toHaveAttribute('aria-rowindex', '3');
  await page.keyboard.press('Home');
  await expect(selectedRow(page)).toHaveAttribute('aria-rowindex', '2');
  await page.keyboard.press('PageDown');
  await expect(selectedRow(page)).toHaveAttribute('aria-rowindex', '3');
  await page.keyboard.press('PageUp');
  await expect(selectedRow(page)).toHaveAttribute('aria-rowindex', '2');
  await page.keyboard.press('Enter');
  await expect(page.locator(`${VIEW} .dcp-http-detail`)).toBeVisible();

  const detailTab = page.locator(`${VIEW} .dcp-http-detail [role="tab"][aria-selected="true"]`);
  await tabTo(page, detailTab, 'detail tab');
  for (let i = 0; i < 4 && (await detailTab.innerText()) !== 'Response'; i += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expect(detailTab).toHaveText('Response');
  await expect(page.locator(`${VIEW} .dcp-http-detail [role="tree"]`)).toBeVisible();
  const rootItem = page.locator(`${VIEW} .dcp-http-detail [role="treeitem"]`).first();
  await tabTo(page, rootItem, 'JSON tree');
  // The tree opens one level by itself. Left closes it, Right opens it and then steps in.
  await expect(rootItem).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(rootItem).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`${VIEW} .dcp-http-detail [role="treeitem"]`)).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(rootItem).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`${VIEW} .dcp-http-detail [role="treeitem"]`)).toHaveCount(3);
  const child = page.locator(`${VIEW} .dcp-http-detail [role="treeitem"][aria-level="2"]`).first();
  await page.keyboard.press('ArrowRight');
  await expect(child).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(rootItem).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rootItem).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Space');
  await expect(rootItem).toHaveAttribute('aria-expanded', 'true');

  // Innermost first: the detail, then the panel (FR-WIN-05).
  await page.keyboard.press('Escape');
  await expect(page.locator(`${VIEW} .dcp-http-detail`)).toBeHidden();
  await expect(page.locator(VIEW)).toBeVisible();
  await page.keyboard.press('Control+KeyF');
  await expect(page.locator(`${VIEW} input[aria-label="Filter requests"]`)).toBeFocused();

  const host = await page.evaluate(() => window.__host);
  expect(host.bubbled, 'keys inside the panel never reach the host').toEqual([]);
  expect(host.hotkeys, 'the page hotkey listener does not see panel keys').toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page.locator(`${PANEL} .dcp-root`)).toBeHidden();
  await expect(page.locator('#host-input')).toBeFocused();
});

test('NFR-A11Y-01, §5.6, §5.7: forced colours keep the status word, the banner bar and the focus ring; reduced motion stays still', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.route('**/api/fast?q=1', (route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' }),
  );
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect(page.locator(VIEW)).toBeVisible();

  await page.evaluate(() => fetch('/api/fast?q=1').catch(() => undefined));
  const failed = page.locator(`${VIEW} .dcp-vlist__body [role="row"]`, { hasText: '404' });
  await expect(failed).toContainText('404');
  await expect(failed.locator('.dcp-http-status svg')).toHaveCount(1);

  const root = page.locator(`${PANEL} .dcp-root`);
  const forcedColor = await root.evaluate((el) => getComputedStyle(el).color);
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
  const plainColor = await root.evaluate((el) => getComputedStyle(el).color);
  expect(forcedColor).not.toBe(plainColor);
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });

  await tabTo(page, page.locator(`${PANEL} button[aria-label="Capture"]`), 'Capture');
  await page.keyboard.press('Enter');
  const banner = page.locator(`${PANEL} .dcp-banner`, { hasText: 'Capture is off' });
  await expect(banner).toBeVisible();
  const bar = await banner.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      width: style.borderInlineStartWidth,
      line: style.borderInlineStartStyle,
      shadow: style.boxShadow,
    };
  });
  expect(bar).toEqual({ width: '2px', line: 'solid', shadow: 'none' });

  const capture = page.locator(`${PANEL} button[aria-label="Capture"]`);
  await expect(capture).toBeFocused();
  const motion = await capture.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      transition: style.transitionDuration,
      animation: style.animationName,
    };
  });
  expect(motion.outlineStyle).not.toBe('none');
  expect(motion.outlineWidth).toBe('2px');
  expect(motion.transition).toBe('0s');
  expect(motion.animation).toBe('none');

  const rootMotion = await root.evaluate((el) => {
    const style = getComputedStyle(el);
    return { transition: style.transitionDuration, animation: style.animationName, scroll: style.scrollBehavior };
  });
  expect(rootMotion).toEqual({ transition: '0s', animation: 'none', scroll: 'auto' });
});
