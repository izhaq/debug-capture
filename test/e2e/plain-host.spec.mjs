/**
 * NFR-PORT-01, plain-page path (S00-07): a plain HTML page loads the prebuilt
 * dist/index.mjs with <script type="module">, installs capture and fetches a
 * local URL; the request is in the buffer.
 */
import { expect, test } from '@playwright/test';

test('a plain page captures its fetch through dist/index.mjs', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  const reply = await page.evaluate(() => window.hostDone);
  expect(reply).toEqual({ pong: true });

  const entries = await page.evaluate(async () => {
    const { getActiveCaptureSession } = await import('/dist/index.mjs');
    const session = getActiveCaptureSession();
    return session === null ? null : session.recorder.snapshot();
  });

  expect(entries).not.toBeNull();
  const http = entries.filter((e) => e.kind === 'http');
  expect(http).toEqual([
    expect.objectContaining({
      transport: 'fetch',
      method: 'GET',
      url: expect.stringMatching(/\/api\/ping$/),
      status: 200,
    }),
  ]);
  expect(pageErrors).toEqual([]);
});
