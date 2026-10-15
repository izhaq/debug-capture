import { defaultCaptureFileName } from '../..';
import { fakeCapture, httpEntry, pendingRequest } from './fakes.spec';
import { createLocalDataSource } from './local-data-source';
import { PanelDataEvent } from './panel-data-source';

/** Any object stands in for the shadow root: the source only passes it on. */
const ROOT = {} as ShadowRoot;

describe('createLocalDataSource (S03-01)', () => {
  it('reads snapshot, pending, stats, capacity and redactedValue from the controller', () => {
    const { controller, recorder } = fakeCapture({ maxEntries: 42, redactedValue: '***' });
    recorder.push(httpEntry(1));
    recorder.start(pendingRequest(7));
    const source = createLocalDataSource(controller);

    expect(source.snapshot().map((e) => e.seq)).toEqual([1]);
    expect(source.pending().map((p) => p.id)).toEqual([7]);
    expect(source.stats().recorded).toBe(1);
    expect(source.capacity()).toBe(42);
    expect(source.redactedValue()).toBe('***');
    expect(source.exportJson()).toBe('{"entries":1}');
  });

  it('maps every recorder and controller event to a PanelDataEvent', () => {
    const { controller, recorder } = fakeCapture();
    const source = createLocalDataSource(controller);
    const events: PanelDataEvent[] = [];
    source.subscribe((e) => events.push(e));

    recorder.push(httpEntry(1));
    recorder.start(pendingRequest(2));
    recorder.end(2);
    recorder.drop();
    controller.stop();
    source.clear();

    expect(events.map((e) => e.type)).toEqual(['entry', 'pending-start', 'pending-end', 'stats', 'capture', 'cleared']);
    expect(events[0]).toEqual({ type: 'entry', entry: httpEntry(1) });
    expect(events[1]).toEqual({ type: 'pending-start', request: pendingRequest(2) });
    expect(events[2]).toEqual({ type: 'pending-end', id: 2 });
    expect(events[3]).toEqual({ type: 'stats', stats: { recorded: 1, dropped: 1, evicted: 0, failed: 0 } });
    expect(events[4]).toEqual({ type: 'capture', on: false });
  });

  it('unsubscribe removes every underlying listener, and is idempotent', () => {
    const { controller, recorder, controllerListeners } = fakeCapture();
    const source = createLocalDataSource(controller);
    const off = source.subscribe(() => undefined);
    expect(recorder.listenerCount()).toBe(3);
    expect(controllerListeners.size).toBe(1);

    off();
    off();
    expect(recorder.listenerCount()).toBe(0);
    expect(controllerListeners.size).toBe(0);
  });

  it('isolates a throwing listener: the recorder never sees the error, other subscribers still hear', () => {
    const { controller, recorder } = fakeCapture();
    const source = createLocalDataSource(controller);
    const seen: string[] = [];
    source.subscribe(() => {
      throw new Error('view bug');
    });
    source.subscribe((e) => seen.push(e.type));

    expect(() => recorder.push(httpEntry(1))).not.toThrow();
    expect(() => controller.stop()).not.toThrow();
    expect(seen).toEqual(['entry', 'capture']);
  });

  it('capture.on / start / stop follow the controller', () => {
    const { controller, calls } = fakeCapture();
    const source = createLocalDataSource(controller);
    expect(source.capture.on).toBe(true);
    source.capture.stop();
    expect(source.capture.on).toBe(false);
    source.capture.start();
    expect(source.capture.on).toBe(true);
    expect(calls).toEqual(['stop', 'start']);
  });

  it('clear() clears through the session', () => {
    const { controller, recorder, calls } = fakeCapture();
    recorder.push(httpEntry(1));
    createLocalDataSource(controller).clear();
    expect(calls).toEqual(['session.clear']);
    expect(recorder.entries).toEqual([]);
  });

  it('download(root) saves exportJson() under the v1 file name, with the root passed to the sink', () => {
    const { controller, recorder } = fakeCapture();
    recorder.push(httpEntry(1));
    const downloads: unknown[][] = [];
    const source = createLocalDataSource(controller, {
      downloadText: (text, filename, root) => downloads.push([text, filename, root]),
    });
    source.download(ROOT);
    // The name comes from the session's clock, never the wall clock.
    const name = defaultCaptureFileName(new Date(controller.session.clock.now()));
    expect(name).toMatch(/^debug-capture-2026101[56]-\d{6}\.json$/);
    expect(downloads).toEqual([['{"entries":1}', name, ROOT]]);
  });

  it('download(root) never throws into the caller', () => {
    const { controller } = fakeCapture();
    const source = createLocalDataSource(controller, {
      downloadText: () => {
        throw new Error('blocked');
      },
    });
    expect(() => source.download(ROOT)).not.toThrow();
  });

  it('copyText(text, root) passes the root to the sink and resolves false instead of rejecting', async () => {
    const { controller } = fakeCapture();
    const copies: unknown[][] = [];
    const ok = createLocalDataSource(controller, {
      copyText: async (text, root) => {
        copies.push([text, root]);
        return true;
      },
    });
    expect(await ok.copyText('abc', ROOT)).toBe(true);
    expect(copies).toEqual([['abc', ROOT]]);

    const rejecting = createLocalDataSource(controller, { copyText: () => Promise.reject(new Error('denied')) });
    expect(await rejecting.copyText('abc', ROOT)).toBe(false);
    const throwing = createLocalDataSource(controller, {
      copyText: () => {
        throw new Error('sync');
      },
    });
    expect(await throwing.copyText('abc', ROOT)).toBe(false);
  });

  it('the default sinks are the L5 ones and still resolve without rejecting', async () => {
    const { controller } = fakeCapture();
    const source = createLocalDataSource(controller);
    // Headless Chromium: the real clipboard may refuse; either answer is fine, a rejection is not.
    const result = await source.copyText('x', ROOT);
    expect(typeof result).toBe('boolean');
  });
});
