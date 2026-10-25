/**
 * NFR-PERF-02/03/04/06 measured (S10-11), on the hostile host (strict CSP,
 * hostile CSS, the real capture controller) with 5,000 entries in the buffer.
 * Runs as its own Playwright project after the e2e project, one test at a
 * time, so the other tests' browsers do not share the CPU with a measurement.
 * Each test logs its numbers (`perf …` lines) for the PR; the limits and
 * what they were set from are next to each test (margin rule, HLD §7.1).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const ORIGIN = process.env.E2E_HOSTILE_ORIGIN ?? `http://127.0.0.1:${process.env.E2E_HOSTILE_PORT ?? 4329}`;
const PANEL = 'debug-capture-panel-v2';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The UI chunk, as `/dist/chunks/app-<hash>.mjs`: importing it first makes the next open "warm". */
const UI_CHUNK = `/dist/chunks/${fs.readdirSync(path.join(root, 'dist', 'chunks')).find((f) => /^app-[\w-]+\.mjs$/.test(f))}`;

test.use({ viewport: { width: 1920, height: 1080 } });

/** Records `count` entries the way the probes would: 40 % HTTP (with a JSON body), 30 % WebSocket, 30 % console. */
function fill(page, count) {
  return page.evaluate((n) => {
    const { recorder, clock } = window.__dc.controller.session;
    for (let i = 0; i < n; i++) {
      // A different ~600-character JSON body per request, as real traffic has.
      const body = JSON.stringify({
        order: i,
        items: Array.from({ length: 12 }, (_, j) => ({ id: i * 100 + j, name: `item ${j}`, ok: true })),
      });
      const t = clock.now();
      const k = i % 10;
      if (k < 4) {
        recorder.record({
          kind: 'http',
          t,
          transport: i % 2 ? 'xhr' : 'fetch',
          method: 'GET',
          url: `${location.origin}/api/orders/${i}?page=${k}`,
          status: k === 3 ? 500 : 200,
          durationMs: 12 + k,
          reqHeaders: { accept: 'application/json' },
          resHeaders: { 'content-type': 'application/json' },
          reqBody: null,
          resBody: body,
          bytes: body.length,
          error: null,
        });
      } else if (k < 7) {
        recorder.record({
          kind: 'ws',
          t,
          socketId: 1 + (i % 3),
          url: 'wss://app.test/live',
          event: 'receive',
          opcode: 'text',
          bytes: 40,
          data: `{"tick":${i},"price":${i * 3}}`,
          code: null,
        });
      } else {
        recorder.record({
          kind: 'log',
          t,
          level: k === 9 ? 'warn' : 'log',
          args: [`message ${i}`, { i, nested: { a: [1, 2, 3] } }],
        });
      }
    }
    return recorder.snapshot().length;
  }, count);
}

async function load(page) {
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.__ready === true);
  expect(await fill(page, 5_000)).toBe(5_000);
}

/** ms from `handle.open()` to the first frame painted with HTTP rows (two rAFs after they exist). */
function timeOpen(page) {
  return page.evaluate(
    (tag) =>
      new Promise((done) => {
        const t0 = performance.now();
        window.__dc.handle.open();
        const check = () => {
          const rows = document
            .querySelector(tag)
            ?.shadowRoot?.querySelectorAll('.dcp-http .dcp-vlist__body [role="row"]');
          if (rows && rows.length > 0)
            requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now() - t0)));
          else requestAnimationFrame(check);
        };
        check();
      }),
    PANEL,
  );
}

/** Starts collecting long tasks (> 50 ms); returns a function that stops and returns their durations. */
async function watchLongTasks(page) {
  await page.evaluate(() => {
    window.__long = [];
    window.__longObs = new PerformanceObserver((list) =>
      list.getEntries().forEach((e) => window.__long.push(Math.round(e.duration))),
    );
    window.__longObs.observe({ type: 'longtask' });
  });
  return () =>
    page.evaluate(() => {
      window.__longObs.disconnect();
      return window.__long;
    });
}

/**
 * Limit 100 ms is the HLD requirement itself, not a margin-rule limit, so the
 * margin is thin: measured warm 49–75 ms (S-10b, Chromium 153, 4 CPUs, 3 runs).
 * The regression it guards against — building rows for all 5,000 entries — is
 * several times over. Cold (the chunk fetched from the local server) 77–102 ms:
 * reported, not gated (NFR-PERF-02).
 */
test('NFR-PERF-02: first open with 5,000 entries — warm under 100 ms; cold measured', async ({ page }) => {
  await load(page);
  const cold = await timeOpen(page);
  await page.goto('about:blank');

  await load(page);
  await page.evaluate((url) => import(url), UI_CHUNK);
  const warm = await timeOpen(page);
  console.log(`perf NFR-PERF-02 open: warm ${warm.toFixed(1)} ms, cold ${cold.toFixed(1)} ms (5,000 entries)`);
  expect(warm).toBeLessThan(100);
});

/**
 * No long task (> 50 ms) while 100 entries/s arrive (NFR-PERF-03). Measured:
 * none in 3 runs; frames at the 16.8 ms vsync. A single 80 ms stall in the
 * page fails it (checked once). The 8 ms per-frame apply budget itself is
 * locked by the event-queue unit specs (`src/panel/app/event-queue`).
 */
test('NFR-PERF-03: 100 entries/s for 3 s while open — no long task', async ({ page }) => {
  await load(page);
  await timeOpen(page);
  const stop = await watchLongTasks(page);
  const frames = await page.evaluate(
    () =>
      new Promise((done) => {
        const { recorder, clock } = window.__dc.controller.session;
        const gaps = [];
        let last = performance.now();
        let running = true;
        const tick = (now) => {
          gaps.push(now - last);
          last = now;
          if (running) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        let i = 0;
        const timer = setInterval(() => {
          recorder.record({ kind: 'log', t: clock.now(), level: 'log', args: [`live ${i++}`] });
          if (i === 300) {
            clearInterval(timer);
            running = false;
            setTimeout(() => done(gaps), 100);
          }
        }, 10);
      }),
  );
  const long = await stop();
  const sorted = frames.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(
    `perf NFR-PERF-03 live 100/s: ${frames.length} frames, p95 frame ${p95.toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms, long tasks ${JSON.stringify(long)}`,
  );
  expect(long).toEqual([]);
});

/**
 * Under 2,000 shadow-root nodes per tab with the detail open, the panel
 * maximized at 1,080 px (NFR-PERF-04). Measured: HTTP 795 (JSON tree open),
 * WebSocket 972, Console 1,263 — the same in 3 runs (node counts do not vary
 * with load). Rendering every entry would be ~23 nodes × 5,000. Scrolling the
 * Console list end to end, one viewport per frame: no long task.
 */
test('NFR-PERF-04: under 2,000 nodes per tab with the detail open at 1,080 px; scrolling makes no long task', async ({
  page,
}) => {
  await load(page);
  await timeOpen(page);
  await page.getByRole('button', { name: 'Maximize panel' }).click();
  const nodes = () =>
    page.evaluate((tag) => document.querySelector(tag).shadowRoot.querySelectorAll('*').length, PANEL);
  const counts = {};

  const http = `${PANEL} .dcp-http`;
  await page.locator(`${http} .dcp-vlist__body [role="row"]`).first().click();
  await page.locator(`${http} .dcp-http-detail [role="tab"]`, { hasText: 'Response' }).click();
  await expect(page.locator(`${http} .dcp-http-detail [role="tree"]`)).toBeVisible();
  counts.http = await nodes();

  await page.locator(`${PANEL} #dcp-subtab-ws`).click();
  await page.locator(`${PANEL} .dcp-ws .dcp-list-pane .dcp-vlist__body [role="row"]`).first().click();
  await expect(page.locator(`${PANEL} .dcp-ws-detail`)).toBeVisible();
  counts.ws = await nodes();

  await page.keyboard.press('Alt+Digit2');
  await page.locator(`${PANEL} .dcp-console .dcp-vlist__body [role="row"]`).first().click();
  await expect(page.locator(`${PANEL} .dcp-console-detail`)).toBeVisible();
  counts.console = await nodes();

  // Scroll the console list end to end in viewport-sized steps, one per frame.
  const stop = await watchLongTasks(page);
  const steps = await page.evaluate(
    (tag) =>
      new Promise((done) => {
        const grid = document.querySelector(tag).shadowRoot.querySelector('.dcp-console [role="grid"]');
        let n = 0;
        const step = () => {
          grid.scrollTop += grid.clientHeight;
          n++;
          if (grid.scrollTop + grid.clientHeight < grid.scrollHeight - 1) requestAnimationFrame(step);
          else done(n);
        };
        grid.scrollTop = 0;
        requestAnimationFrame(step);
      }),
    PANEL,
  );
  const long = await stop();
  const panelHeight = await page.evaluate(
    (tag) =>
      Math.round(document.querySelector(tag).shadowRoot.querySelector('.dcp-root').getBoundingClientRect().height),
    PANEL,
  );
  console.log(
    `perf NFR-PERF-04 nodes (panel ${panelHeight} px tall): ${JSON.stringify(counts)}; scroll ${steps} steps, long tasks ${JSON.stringify(long)}`,
  );
  for (const count of Object.values(counts)) expect(count).toBeLessThan(2_000);
  expect(long).toEqual([]);
});

/**
 * Memory the open panel adds on top of the buffer, after a forced GC (CDP
 * `HeapProfiler.collectGarbage` + `Runtime.getHeapUsage`; NFR-PERF-06).
 * Measured 1.46–1.66 MB over 3 runs (buffer 3.4 MB); limit 10 MB, the HLD
 * number, ~6× above.
 */
test('NFR-PERF-06: the open panel adds under 10 MB on top of a 5,000-entry buffer', async ({ page }) => {
  await load(page);
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  const before = await heap();
  await timeOpen(page);
  await page.locator(`${PANEL} .dcp-http .dcp-vlist__body [role="row"]`).first().click();
  await page.locator(`${PANEL} #dcp-subtab-ws`).click();
  await page.keyboard.press('Alt+Digit2');
  await page.keyboard.press('Alt+Digit1');
  const after = await heap();
  const addedMb = (after - before) / 1024 / 1024;
  console.log(
    `perf NFR-PERF-06 memory: heap ${(before / 1048576).toFixed(1)} → ${(after / 1048576).toFixed(1)} MB, panel adds ${addedMb.toFixed(2)} MB`,
  );
  expect(addedMb).toBeLessThan(10);
});
