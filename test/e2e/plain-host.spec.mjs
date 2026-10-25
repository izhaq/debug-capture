/**
 * NFR-PORT-01, plain-page path (S00-07): a plain HTML page loads the prebuilt
 * index.mjs and panel.mjs (a vendored copy of dist/, HLD §6.6) with
 * <script type="module">, installs capture and fetches a local URL; the
 * request lands in the buffer. The panel itself: hosts.spec.mjs (S-10a).
 */
import { expect, test } from '@playwright/test';

test('a plain page captures its fetch through the vendored index.mjs', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/plain/?debug=1');
  const reply = await page.evaluate(() => window.hostDone);
  expect(reply).toEqual({ pong: true });
  // The panel loader bundle loads next to the core and runs.
  expect(await page.evaluate(() => window.panelElementName)).toBe('debug-capture-panel-v2');

  // The fetch probe records once it has read its own clone of the body,
  // which can finish after the page's own promise: poll the buffer.
  const httpEntries = () =>
    page.evaluate(async () => {
      const { getActiveCaptureSession } = await import('/plain/vendor/debug-capture/index.mjs');
      const session = getActiveCaptureSession();
      return session === null ? null : session.recorder.snapshot().filter((e) => e.kind === 'http');
    });
  await expect.poll(httpEntries, { timeout: 5000 }).toEqual([
    expect.objectContaining({
      transport: 'fetch',
      method: 'GET',
      url: expect.stringMatching(/\/api\/ping$/),
      status: 200,
    }),
  ]);
  expect(pageErrors).toEqual([]);
});
