import { CaptureSessionSource } from '..';

/**
 * React's error callbacks, without React. This repo has no React and this
 * layer imports no packages, so the adapter is a set of plain functions with
 * exactly the signatures React calls — from `createRoot` / `hydrateRoot`
 * options (React 19) or an error boundary's `componentDidCatch` (React 18).
 *
 * The capture layer already sees what reaches the window. What it cannot see
 * is an error React handled itself, with React's component stack — the
 * "which component broke" that a minified stack does not tell you. Like the
 * Angular `ErrorHandler` seam, the adapter records that, then always does
 * exactly what the app or React would have done without it.
 */

/** What React passes as the second argument. */
export interface ReactErrorInfo {
  readonly componentStack?: string | null | undefined;
}

/** Matches React 19 `createRoot` / `hydrateRoot` RootOptions error callbacks. */
export interface ReactRootErrorOptions {
  onUncaughtError: (error: unknown, errorInfo: ReactErrorInfo) => void;
  onCaughtError: (error: unknown, errorInfo: ReactErrorInfo & { readonly errorBoundary?: unknown }) => void;
  onRecoverableError: (error: unknown, errorInfo: ReactErrorInfo) => void;
}

/** React's own default behaviour, injectable for specs. */
export interface ReactErrorDefaults {
  /** React's default for uncaught and recoverable errors (`reportError`). */
  reportError(error: unknown): void;
  /** React's default for caught errors (`console.error`). */
  logError(error: unknown): void;
}

type ReactErrorHandling = 'uncaught' | 'caught' | 'recoverable';

/** How each handling reads in the exported stack. */
const HANDLING_LABELS: Readonly<Record<ReactErrorHandling, string>> = Object.freeze({
  uncaught: 'uncaught',
  caught: 'caught by an error boundary',
  recoverable: 'recovered',
});

/**
 * The three React 19 root error callbacks. Spread them into the options:
 * `createRoot(el, { ...createReactRootErrorOptions(session) })`.
 *
 * Each one records the error, then calls the app's own handler from `next`
 * when there is one, otherwise React's default — so the app behaves exactly
 * as it would without capture. That call is deliberately not guarded: if the
 * app's handler throws, React must see the same throw it would have seen.
 *
 * With a `null` or inactive session the callbacks only delegate.
 */
export function createReactRootErrorOptions(
  session: CaptureSessionSource,
  next: Partial<ReactRootErrorOptions> = {},
  defaults: ReactErrorDefaults = reactDefaultErrorBehaviour(),
): ReactRootErrorOptions {
  // `next` is read at call time, and its handlers are called as methods, so
  // an options object the app keeps and changes works the same as with React.
  return {
    onUncaughtError: (error, errorInfo) => {
      recordReactError(session, error, errorInfo, 'uncaught');
      if (next.onUncaughtError) {
        next.onUncaughtError(error, errorInfo);
      } else {
        defaults.reportError(error);
      }
    },
    onCaughtError: (error, errorInfo) => {
      recordReactError(session, error, errorInfo, 'caught');
      if (next.onCaughtError) {
        next.onCaughtError(error, errorInfo);
      } else {
        defaults.logError(error);
      }
    },
    onRecoverableError: (error, errorInfo) => {
      recordReactError(session, error, errorInfo, 'recoverable');
      if (next.onRecoverableError) {
        next.onRecoverableError(error, errorInfo);
      } else {
        defaults.reportError(error);
      }
    },
  };
}

/**
 * For React 18 error boundaries: call from `componentDidCatch(error, info)`.
 * Also what the root callbacks above use. Records only while the session is
 * active, and never throws — a debug tool must not turn one error into two.
 */
export function recordReactError(
  session: CaptureSessionSource,
  error: unknown,
  errorInfo?: ReactErrorInfo,
  handling: 'uncaught' | 'caught' | 'recoverable' = 'caught',
): void {
  try {
    // 2.2 (FR-BG-10): a getter, read now, for a session switched on after the root was created.
    const current = typeof session === 'function' ? session() : session;
    if (!current?.active) {
      return;
    }
    const { message, stack } = describeError(error);
    current.recorder.record({
      kind: 'error',
      source: 'react',
      t: current.clock.now(),
      message,
      stack: withComponentStack(stack, errorInfo?.componentStack, handling),
    });
  } catch {
    // Intentionally ignored — see above.
  }
}

/**
 * The component stack goes into `stack`, not a new field: the recorder
 * already redacts and truncates `stack`, and the file format stays the same.
 */
function withComponentStack(
  stack: string | null,
  componentStack: string | null | undefined,
  handling: ReactErrorHandling,
): string | null {
  if (typeof componentStack !== 'string' || componentStack === '') {
    return stack;
  }
  // React's component stack starts with a newline; keep it as given, and
  // only add one when it does not, so the frames never share the header line.
  const separator = componentStack.startsWith('\n') ? '' : '\n';
  const section = `React component stack (${HANDLING_LABELS[handling]}):${separator}${componentStack}`;
  return stack === null ? section : `${stack}\n\n${section}`;
}

/*
 * describeError / stringify repeat the Angular handler's rule on purpose:
 * the two seams are sibling layers and may not import each other, and the
 * rule is too small to earn a place in the shared contract.
 */

function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message, stack: typeof error.stack === 'string' ? error.stack : null };
  }
  if (typeof error === 'string') {
    return { message: error, stack: null };
  }
  return { message: stringify(error), stack: null };
}

/** JSON first for readable objects; String() for circular values and for what JSON.stringify returns undefined on. */
function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// React's defaults
// ---------------------------------------------------------------------------

/** The globals React's defaults read — a plain object in specs. */
export interface ReactDefaultsScope {
  readonly reportError?: (error: unknown) => void;
  readonly window?: {
    readonly ErrorEvent?: new (type: string, init: ErrorEventInit) => Event;
    dispatchEvent(event: Event): boolean;
  };
  readonly console?: { error(...data: unknown[]): void };
}

/**
 * What React 19 does when a root callback is not given, reproduced from
 * `react-dom-client.production.js` so passing our callbacks changes nothing:
 * uncaught and recoverable errors go to `reportError` (or, without it, an
 * `ErrorEvent` dispatched on `window`, then `console.error` unless a listener
 * cancelled it); caught errors go to `console.error`.
 *
 * Every global is read at call time, as React does: the console probe may
 * patch `console.error` after this is built, and React's own call would go
 * through that patch too. This is the one place this layer calls
 * `console.*` — only to do what React itself would have done.
 *
 * Not exported from the barrel: only specs pass a scope.
 */
export function reactDefaultErrorBehaviour(scope: ReactDefaultsScope = globalThis): ReactErrorDefaults {
  const logError = (error: unknown): void => {
    if (scope.console && typeof scope.console.error === 'function') {
      scope.console.error(error);
    }
  };
  return {
    reportError: (error) => {
      if (typeof scope.reportError === 'function') {
        scope.reportError(error);
        return;
      }
      const win = scope.window;
      if (typeof win === 'object' && win !== null && typeof win.ErrorEvent === 'function') {
        const event = new win.ErrorEvent('error', {
          bubbles: true,
          cancelable: true,
          message: errorEventMessage(error),
          error,
        });
        if (!win.dispatchEvent(event)) {
          return;
        }
      }
      logError(error);
    },
    logError,
  };
}

/** React's rule for the event's `message`. */
function errorEventMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : String(error);
}
