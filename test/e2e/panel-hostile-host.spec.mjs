/**
 * S-02 isolation on the hostile host (ISO-22, NFR-ISO-01): the panel loader
 * from dist/panel.mjs on test/hostile-host/, a page with the strict CSP +
 * Trusted Types header, hostile CSS (research §4) and the listeners a real
 * app has. Every test also checks, after it runs, that the page saw no CSP
 * violation and no page error (NFR-SEC-02, ISO-04, ISO-12).
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const TOGGLE = 'Control+Alt+Shift+KeyP';

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

async function open(page, path = '/') {
  await page.goto(ORIGIN + path);
  await page.waitForFunction(() => window.__ready === true);
}

/** In-page helpers, as strings of code are not allowed under the CSP: evaluate only. */
const panelState = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('html > debug-capture-panel-v2');
    const shadow = host?.shadowRoot;
    const root = shadow?.querySelector('.dcp-root') ?? null;
    return {
      count: document.querySelectorAll('debug-capture-panel-v2').length,
      isOpen: window.__dc?.handle?.isOpen ?? null,
      rootVisible: root !== null && !root.hidden,
      focusInRoot: root !== null && root.contains(shadow.activeElement),
      launcherHidden: shadow?.querySelector('.dcp-launcher')?.hidden ?? null,
    };
  });

/** Every computed property of an element, for before/after comparisons. */
function computedAll(selectorOrPath) {
  const find = (spec) => {
    if (typeof spec === 'string') return document.querySelector(spec);
    const host = document.querySelector('html > debug-capture-panel-v2');
    return host?.shadowRoot.querySelector(spec.inner) ?? null;
  };
  const el = find(selectorOrPath);
  if (!el) return null;
  const style = getComputedStyle(el);
  const out = {};
  for (let i = 0; i < style.length; i++) out[style[i]] = style.getPropertyValue(style[i]);
  return out;
}

const launcherBox = (page) =>
  page.evaluate(() => {
    const r = document
      .querySelector('html > debug-capture-panel-v2')
      .shadowRoot.querySelector('.dcp-launcher')
      .getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });

// ---------------------------------------------------------------------------

test('ISO-01/02/06/14/15: one locked-down host element on <html>, after <body>, in the top layer', async ({ page }) => {
  await open(page);
  const host = await page.evaluate(() => {
    const el = document.querySelector('debug-capture-panel-v2');
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      parentIsHtml: el.parentNode === document.documentElement,
      afterBody: Boolean(document.body.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
      topLayer: el.matches(':popover-open'),
      attributes: Array.from(el.attributes).map((a) => a.name),
      display: style.display,
      position: style.position,
      margin: style.margin,
      zIndex: style.zIndex,
      contain: style.contain,
      pointerEvents: style.pointerEvents,
      visibility: style.visibility,
      direction: style.direction,
      animations: el.getAnimations().length,
      transition: style.transitionDuration,
      rect: [rect.x, rect.y, rect.width, rect.height],
      viewport: [0, 0, document.documentElement.clientWidth, document.documentElement.clientHeight],
      windowGlobal: 'debug-capture-panel-v2' in window,
    };
  });

  expect(host.parentIsHtml).toBe(true);
  expect(host.afterBody).toBe(true);
  expect(host.topLayer).toBe(true);
  expect(host.attributes).toEqual(['popover']);
  // The hostile CSS says display:none !important, position:relative, margin:5px, z-index:1, spin… (research S6).
  expect(host).toMatchObject({
    display: 'block',
    position: 'fixed',
    margin: '0px',
    zIndex: '2147483647',
    contain: 'strict',
    pointerEvents: 'none',
    visibility: 'visible',
    direction: 'ltr',
    animations: 0,
    transition: '0s',
    windowGlobal: false,
  });
  expect(host.rect).toEqual(host.viewport);

  // ISO-06: hidden when printing.
  await page.emulateMedia({ media: 'print' });
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('debug-capture-panel-v2')).display)).toBe(
    'none',
  );
});

test('ISO-01/13, research L2/L7: the host page’s computed styles and layout do not change on install, open or close', async ({
  page,
}) => {
  await open(page, '/?nopanel');
  const targets = ['html', 'head', 'body', '#app', 'h1', '#host-input', '#menu', '#dialog'];
  const snapshot = async () => ({
    styles: await Promise.all(targets.map((t) => page.evaluate(computedAll, t))),
    page: await page.evaluate(() => ({
      bodyRect: JSON.stringify(document.body.getBoundingClientRect()),
      inline: [document.documentElement.getAttribute('style'), document.body.getAttribute('style')],
      scroll: [window.scrollX, window.scrollY],
      bodyChildren: document.body.children.length,
    })),
  });
  const before = await snapshot();

  await page.evaluate(() => window.__dc.install({}));
  const installed = await snapshot();
  await page.evaluate(() => window.__dc.handle.open());
  await expect.poll(() => panelState(page)).toMatchObject({ rootVisible: true });
  const opened = await snapshot();
  await page.evaluate(() => window.__dc.handle.close());
  const closed = await snapshot();

  expect(installed).toEqual(before);
  expect(opened).toEqual(before);
  expect(closed).toEqual(before);
  expect(await page.evaluate(() => window.__host.bodyMutations)).toBe(0); // research P9
});

test('ISO-02…05, research S1–S5: the panel’s own styles are the same with and without the hostile CSS', async ({
  page,
}) => {
  const collect = async (path) => {
    await open(page, path);
    const launcher = await page.evaluate(computedAll, { inner: '.dcp-launcher' });
    const launcherRect = await launcherBox(page);
    await page.evaluate(() => window.__dc.handle.open());
    await expect.poll(() => panelState(page)).toMatchObject({ rootVisible: true });
    return {
      launcher,
      launcherRect,
      root: await page.evaluate(computedAll, { inner: '.dcp-root' }),
      button: await page.evaluate(computedAll, { inner: '.dcp-root button' }),
      title: await page.evaluate(computedAll, { inner: '.dcp-root span' }),
    };
  };
  // Host custom properties do reach our nodes (research S3, `all` skips them) and are
  // compared apart: the loader's sheet uses literal colours, so they change nothing.
  const own = (styles) => Object.fromEntries(Object.entries(styles).filter(([name]) => !name.startsWith('--')));
  const calm = await collect('/calm.html');
  const hostile = await collect('/');
  for (const part of ['launcher', 'root', 'button', 'title']) {
    calm[part] = own(calm[part]);
    hostile[part] = own(hostile[part]);
  }

  expect(hostile.launcher).toEqual(calm.launcher);
  expect(hostile.launcherRect).toEqual(calm.launcherRect);
  expect(hostile.root).toEqual(calm.root);
  expect(hostile.button).toEqual(calm.button);
  expect(hostile.title).toEqual(calm.title);
  expect(hostile.root.direction).toBe('ltr');
  expect(hostile.root['font-size']).toBe('12px'); // not 10px-root rem (S5)
  expect(hostile.root['background-color']).toBe('rgb(255, 255, 255)'); // not hotpink, not broken by @property (S3, S4)
});

test('research S13/L1: html filter, body opacity/transform and ::backdrop do not touch the launcher’s pixels', async ({
  page,
}) => {
  const shot = async (path) => {
    await open(page, path);
    await page.evaluate(() => window.scrollTo(0, 500));
    const box = await launcherBox(page);
    // Inside the rounded corners, so only our own pixels are compared.
    return page.screenshot({ clip: { x: box.x + 7, y: box.y + 7, width: box.width - 14, height: box.height - 14 } });
  };
  const calm = await shot('/calm.html');
  const hostile = await shot('/');

  expect(hostile.equals(calm)).toBe(true);
  // L1: still pinned 12 px from the viewport corner after the page scrolled, under a transformed <body>.
  const box = await launcherBox(page);
  const viewport = page.viewportSize();
  expect(Math.round(viewport.height - (box.y + box.height))).toBe(12);
});

test('research S13 + ::backdrop: the host page looks the same with the panel installed as without it', async ({
  page,
}) => {
  const shot = async (path) => {
    await open(page, path);
    const r = await page.evaluate(() =>
      JSON.parse(JSON.stringify(document.getElementById('app').getBoundingClientRect())),
    );
    return page.screenshot({ clip: { x: r.x, y: r.y, width: Math.min(r.width, 600), height: r.height } });
  };
  const without = await shot('/?nopanel');
  const withPanel = await shot('/');

  expect(withPanel.equals(without)).toBe(true);
});

test('ISO-07, research E1–E5/E7/E9: clicks, keys, wheel and clipboard inside the panel never reach host bubble listeners', async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press(TOGGLE);
  await expect.poll(() => panelState(page)).toMatchObject({ rootVisible: true, focusInRoot: true });
  // The toggle chord itself was typed on the page, outside the panel: the host may see it.
  await page.evaluate(() => (window.__host.hotkeys = []));

  const title = page.locator('debug-capture-panel-v2 .dcp-root span');
  await title.click();
  await title.dblclick();
  await title.click({ button: 'right' });
  const root = await page.evaluate(() => {
    const r = document
      .querySelector('debug-capture-panel-v2')
      .shadowRoot.querySelector('.dcp-root')
      .getBoundingClientRect();
    return { x: r.x + r.width - 20, y: r.y + r.height - 20 };
  });
  await page.mouse.click(root.x, root.y); // the panel root's empty area (research E7)
  await page.mouse.move(root.x, root.y);
  await page.mouse.wheel(0, 200);
  await page.keyboard.type('a/ x');
  for (const key of ['Space', 'PageDown', 'ArrowDown', 'End', 'Delete', 'Control+C', 'Enter']) {
    await page.keyboard.press(key);
  }
  // Keyboard and wheel scrolls are smooth: give them time to land before reading scrollY.
  await page.waitForTimeout(600);

  const host = await page.evaluate(() => window.__host);
  expect(host.bubbled).toEqual([]);
  expect(host.hotkeys).toEqual([]);
  expect(host.copies).toBe(0);
  expect(host.menuOpen).toBe(true);
  expect(host.dialogOpen).toBe(true);
  // D-16: the host's capture-phase listeners are never blocked (research E3).
  expect(host.captured).toEqual(expect.arrayContaining(['pointerdown', 'click', 'keydown']));
  // ISO-13, research L9: neither the wheel nor a scroll key over the panel moves the host page.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Escape is the panel's: it closes the panel, and the host's "dialog" stays open (E5).
  await page.keyboard.press('Escape');
  expect(await panelState(page)).toMatchObject({ isOpen: false });
  expect(await page.evaluate(() => window.__host.dialogOpen)).toBe(true);
});

test('ISO-07/08, research E8: the global Ctrl+Alt+Shift chords still reach the document from inside the panel', async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press(TOGGLE);
  await expect.poll(() => panelState(page)).toMatchObject({ focusInRoot: true });
  await page.evaluate(() => (window.__host.hotkeys = []));

  // Only the chord's real key crosses the wall, not the modifiers pressed on the way.
  await page.keyboard.press('Control+Alt+Shift+KeyD');
  expect(await page.evaluate(() => window.__host.hotkeys)).toEqual(['D']);

  // The toggle chord from inside the panel closes it, and focus goes back.
  await page.keyboard.press(TOGGLE);
  expect(await panelState(page)).toMatchObject({ isOpen: false, rootVisible: false });
});

test('research E2: the host’s "click outside closes the menu" still works for clicks outside the panel', async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press(TOGGLE);
  await expect.poll(() => panelState(page)).toMatchObject({ rootVisible: true });

  await page.locator('debug-capture-panel-v2 .dcp-root span').click();
  expect(await page.evaluate(() => window.__host.menuOpen)).toBe(true);

  await page.locator('#app h1').click({ force: true });
  expect(await page.evaluate(() => window.__host.menuOpen)).toBe(false);
});

test('FR-ACT-07, ISO-16: focus moves in from the shortcut and returns; handle.open() never steals it', async ({
  page,
}) => {
  await open(page);
  await page.locator('#host-input').focus();
  await page.keyboard.press(TOGGLE);
  await expect.poll(() => panelState(page)).toMatchObject({ focusInRoot: true });

  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('host-input');

  await page.evaluate(() => window.__dc.handle.open());
  await expect.poll(() => panelState(page)).toMatchObject({ rootVisible: true });
  await page.keyboard.type('typed');
  expect(await page.locator('#host-input').inputValue()).toBe('typed');
  expect(await page.evaluate(() => window.__host.hotkeys)).toEqual([]);
});

test('ISO-16, research F2: while closed, Tab never enters the panel root', async ({ page }) => {
  await open(page);
  await page.keyboard.press(TOGGLE);
  await expect.poll(() => panelState(page)).toMatchObject({ rootVisible: true });
  await page.keyboard.press(TOGGLE);
  await page.locator('#host-input').focus();

  const visited = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    visited.push(await panelState(page));
  }
  expect(visited.some((s) => s.focusInRoot)).toBe(false);
  const root = await page.evaluate(() => {
    const r = document.querySelector('debug-capture-panel-v2').shadowRoot.querySelector('.dcp-root');
    return { hidden: r.hidden, inert: r.inert };
  });
  expect(root).toEqual({ hidden: true, inert: true });
});

test('ISO-14, D-11: a second copy of the loader does not define the element again and adds no second panel', async ({
  page,
}) => {
  await open(page);
  const second = await page.evaluate(async () => {
    const handle = await window.__dc.installSecondCopy();
    handle.open();
    return { isOpen: handle.isOpen };
  });
  expect(second.isOpen).toBe(false);
  expect(await panelState(page)).toMatchObject({ count: 1 });

  // Once the first is gone, the second copy reuses the existing definition.
  const reused = await page.evaluate(async () => {
    window.__dc.handle.dispose();
    const handle = await window.__dc.installSecondCopy();
    handle.open();
    return handle.isOpen;
  });
  expect(reused).toBe(true);
  expect(await page.evaluate(() => window.__host.defines['debug-capture-panel-v2'])).toBe(1);
  expect(await panelState(page)).toMatchObject({ count: 1 });
});

test('ISO-14: when the host owns the tag already, the loader stays silent and inert', async ({ page }) => {
  const logs = [];
  page.on('console', (message) => logs.push(message.text()));
  await open(page, '/?foreign');

  expect(await panelState(page)).toMatchObject({ count: 0, isOpen: false });
  await page.keyboard.press(TOGGLE);
  expect(await page.evaluate(() => window.__dc.handle.isOpen)).toBe(false);
  expect(logs).toEqual([]);
});

test('ISO-20, research D2: the host removes the element; the next open mounts it again', async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.querySelector('debug-capture-panel-v2').remove());
  expect(await panelState(page)).toMatchObject({ count: 0 });

  await page.keyboard.press(TOGGLE);
  await expect.poll(() => panelState(page)).toMatchObject({ count: 1, rootVisible: true, focusInRoot: true });
  expect(await page.evaluate(() => document.querySelector('debug-capture-panel-v2').matches(':popover-open'))).toBe(
    true,
  );
});

test('ISO-01, research L3/L5: the launcher stays clickable over a max z-index overlay and a host auto popover', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.__host.addOverlay();
    document.getElementById('host-popover').showPopover();
  });
  const box = await launcherBox(page);
  expect(await page.evaluate(({ cx, cy }) => document.elementFromPoint(cx, cy).localName, box)).toBe(
    'debug-capture-panel-v2',
  );

  await page.mouse.click(box.cx, box.cy);
  await expect.poll(() => panelState(page)).toMatchObject({ rootVisible: true });
  expect(await page.evaluate(() => window.__host.overlayClicks)).toBe(0);
  expect(await page.evaluate(() => document.querySelector('debug-capture-panel-v2').matches(':popover-open'))).toBe(
    true,
  );
  // The host page around the panel is still the host's: a click there lands on the overlay.
  // (The overlay is fixed under the host's transformed <body>, so it is offset — research L1.)
  const overlay = await page.evaluate(() => {
    const r = window.__host.overlay.getBoundingClientRect();
    return { x: Math.max(r.x, 0) + 100, y: r.y + 20 };
  });
  await page.mouse.click(overlay.x, overlay.y);
  expect(await page.evaluate(() => window.__host.overlayClicks)).toBe(1);
});

test('FR-ACT-02, NFR-SEC-03: the UI chunk loads on first open only; closed, the panel makes no request', async ({
  page,
}) => {
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await open(page);
  const atStart = requests.length;
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.__dc.record(i % 2 === 0);
  });
  await page.waitForTimeout(100);
  expect(requests.length).toBe(atStart);

  await page.keyboard.press(TOGGLE);
  await expect.poll(() => panelState(page)).toMatchObject({ rootVisible: true });
  const loaded = requests.slice(atStart);
  expect(loaded.length).toBe(1);
  expect(loaded[0]).toMatch(/^\/dist\/chunks\/app-[\w-]+\.mjs$/);

  await page.keyboard.press(TOGGLE);
  await page.keyboard.press(TOGGLE);
  await expect.poll(() => panelState(page)).toMatchObject({ rootVisible: true });
  expect(requests.length).toBe(atStart + 1);
});

test('FR-ACT-03/04, ISO-17: the badge counts problems, the launcher is a named button, the panel a labelled dialog', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.__dc.record(true);
    window.__dc.record(false);
    window.__dc.record(true);
  });
  const launcher = page.getByRole('button', { name: 'DBG 2: open debug panel, 2 new problems' });
  await expect(launcher).toHaveText('DBG2');

  await launcher.click();
  const dialog = page.getByRole('dialog', { name: 'Debug panel' });
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(() => {
      const r = document.querySelector('debug-capture-panel-v2').shadowRoot.querySelector('.dcp-root');
      return [r.getAttribute('aria-modal'), r.lang, r.dir, getComputedStyle(r).direction];
    }),
  ).toEqual(['false', 'en', 'ltr', 'ltr']);
  await page.getByRole('button', { name: 'Close debug panel' }).click();
  await expect(page.getByRole('button', { name: 'DBG: open debug panel' })).toBeVisible();
});

test('FR-ACT-03: `launcher: false` shows no launcher; the shortcut still opens the panel', async ({ page }) => {
  await open(page, '/?launcher=0');
  expect(await page.evaluate(() => document.querySelector('debug-capture-panel-v2').shadowRoot.children.length)).toBe(
    0,
  );
  await page.keyboard.press(TOGGLE);
  await expect.poll(() => panelState(page)).toMatchObject({ rootVisible: true, launcherHidden: null });
});
