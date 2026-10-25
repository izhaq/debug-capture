import * as l5 from '../..';
import * as model from './index';
import { CaptureEntry, CaptureStats, PanelDataEvent, PanelDataSource, PendingRequest, Unsubscribe } from './index';

/** `true` only when A and B are the same type (not merely assignable). */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless its type argument is `true`. */
function assertType<T extends true>(): T | undefined {
  return undefined;
}

/**
 * The runtime exports of the L5 barrel (`src/index.ts`) before v2 started.
 * v2 may add exports (S-01 adds `createCaptureController`, `isProblemEntry`)
 * but must never remove one: hosts and the v1 seams import these.
 */
const L5_V1_EXPORTS = [
  'CAPTURE_SCHEMA_VERSION',
  'DEBUG_STORAGE_KEY',
  'DEFAULT_CAPTURE_POLICY',
  'DEFAULT_SHORTCUTS',
  'LOG_LEVELS',
  'RingBuffer',
  'browserEnvironment',
  'buildCaptureFile',
  'copyText',
  'createRecorder',
  'defaultCaptureFileName',
  'downloadText',
  'getActiveCaptureSession',
  'installConsoleProbe',
  'installDebugCapture',
  'installFetchProbe',
  'installGlobalErrorProbe',
  'installWebSocketProbe',
  'installXhrProbe',
  'isDebugRequested',
  'matchesAny',
  'redactHeaders',
  'redactJsonText',
  'redactJsonValue',
  'resolvePolicy',
  'serializeCaptureFile',
  'systemClock',
  'toJsonSafe',
  'truncate',
];

const NO_STATS: CaptureStats = { recorded: 0, dropped: 0, evicted: 0, failed: 0 };

describe('panel model barrel (P1)', () => {
  it('the L5 barrel still exposes every v1 runtime export', () => {
    expect(Object.keys(l5)).toEqual(jasmine.arrayContaining(L5_V1_EXPORTS));
  });

  it('re-exports the whole L5 barrel, value for value', () => {
    // P1 imports only the L5 barrel and re-exports it, so every layer below
    // (P2 … P4) needs a single import path, as in v1.
    const fromModel = new Map(Object.entries(model));
    for (const [name, value] of Object.entries(l5)) {
      expect(fromModel.get(name)).withContext(name).toBe(value);
    }
  });

  it('PanelDataSource and PanelDataEvent have the HLD §6.4 shape', () => {
    assertType<Equals<ReturnType<PanelDataSource['snapshot']>, readonly CaptureEntry[]>>();
    assertType<Equals<ReturnType<PanelDataSource['pending']>, readonly PendingRequest[]>>();
    assertType<Equals<ReturnType<PanelDataSource['stats']>, CaptureStats>>();
    assertType<Equals<ReturnType<PanelDataSource['capacity']>, number>>();
    assertType<Equals<ReturnType<PanelDataSource['redactedValue']>, string>>();
    assertType<Equals<Parameters<PanelDataSource['download']>, [root: ShadowRoot]>>();
    assertType<Equals<Parameters<PanelDataSource['copyText']>, [text: string, root: ShadowRoot]>>();
    assertType<Equals<ReturnType<PanelDataSource['copyText']>, Promise<boolean>>>();
    assertType<
      Equals<
        PanelDataEvent['type'],
        'entry' | 'pending-start' | 'pending-end' | 'cleared' | 'stats' | 'capture' | 'capacity'
      >
    >();

    const listeners: Array<(event: PanelDataEvent) => void> = [];
    let on = true;
    const source: PanelDataSource = {
      snapshot: () => [],
      pending: () => [],
      stats: () => NO_STATS,
      capacity: () => 5000,
      defaultCapacity: () => 5000,
      setCapacity: (): void => undefined,
      addNote: (): void => undefined,
      redactedValue: () => '[redacted]',
      subscribe(listener): Unsubscribe {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
      clear: (): void => undefined,
      exportJson: () => '{}',
      download: (): void => undefined,
      copyText: async () => true,
      capture: {
        get on(): boolean {
          return on;
        },
        start: () => (on = true),
        stop: () => (on = false),
      },
    };

    // Exhaustive: a new event type added to the union stops this compiling.
    const describeEvent = (event: PanelDataEvent): string => {
      switch (event.type) {
        case 'entry':
          return `entry ${event.entry.seq}`;
        case 'pending-start':
          return `start ${event.request.id}`;
        case 'pending-end':
          return `end ${event.id}`;
        case 'cleared':
          return 'cleared';
        case 'stats':
          return `dropped ${event.stats.dropped}`;
        case 'capture':
          return `capture ${event.on}`;
        case 'capacity':
          return `capacity ${event.capacity}`;
        default: {
          const unreachable: never = event;
          return unreachable;
        }
      }
    };

    const seen: string[] = [];
    source.subscribe((event) => seen.push(describeEvent(event)));
    source.capture.stop();
    listeners.forEach((listener) => listener({ type: 'capture', on: source.capture.on }));
    listeners.forEach((listener) => listener({ type: 'stats', stats: { ...NO_STATS, dropped: 2 } }));

    expect(seen).toEqual(['capture false', 'dropped 2']);
    expect(source.capacity()).toBe(5000);
  });
});
