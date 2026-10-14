import {
  ClipboardHost,
  Clock,
  ConsoleHost,
  DownloadHost,
  ErrorEventHost,
  FetchHost,
  WebSocketHost,
  XhrHost,
  systemClock,
} from '../adapters';

/**
 * Every global the capture touches, in one object. `installDebugCapture`
 * reads globals only through this, so its spec can hand in fakes and never
 * patch the real `console`, XHR, `fetch` or `WebSocket` of the test runner.
 */
export interface CaptureEnvironment {
  readonly clock: Clock;
  readonly console: ConsoleHost;
  readonly errors: ErrorEventHost;
  readonly xhr: XhrHost;
  readonly fetch: FetchHost;
  readonly webSocket: WebSocketHost;
  readonly download: DownloadHost;
  readonly clipboard: ClipboardHost;
  /** Where keyboard shortcuts are listened for. */
  readonly keyboard: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  readonly page: { readonly location: { readonly href: string }; readonly userAgent: string };
}

/**
 * The real browser. Everything is read off `globalThis` (a missing global is
 * `undefined`, not a `ReferenceError`), and the page details are getters read
 * at export time — so building this never throws, even somewhere odd. A
 * global that is really missing fails later, where it is handled: a probe
 * that cannot install is recorded as a `capture` error, a failed copy
 * resolves `false`.
 */
export function browserEnvironment(): CaptureEnvironment {
  const g = globalThis;
  return {
    clock: systemClock,
    console: g.console,
    errors: g,
    keyboard: g,
    xhr: g as unknown as XhrHost,
    fetch: g as unknown as FetchHost,
    webSocket: g as unknown as WebSocketHost,
    download: {
      document: g.document,
      URL: g.URL,
      defer: (fn) => {
        setTimeout(fn, 0);
      },
    },
    clipboard: { navigator: g.navigator, document: g.document, isSecureContext: g.isSecureContext },
    page: {
      get location(): { readonly href: string } {
        return g.location ?? { href: '' };
      },
      get userAgent(): string {
        return g.navigator?.userAgent ?? '';
      },
    },
  };
}
