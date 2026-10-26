import {
  AppMessageLevel,
  CaptureController,
  CaptureSession,
  ControlledCaptureSession,
  DEFAULT_NOTE,
  DEFAULT_SHORTCUTS,
  DebugCaptureOptions,
  LiveRecorder,
  Probe,
  ProbeRecorder,
  Recorder,
  ShortcutConfig,
  Unsubscribe,
  Clock,
  buildCaptureFile,
  copyText,
  createRecorder,
  defaultCaptureFileName,
  downloadText,
  installConsoleProbe,
  installFetchProbe,
  installGlobalErrorProbe,
  installWebSocketProbe,
  installXhrProbe,
  resolvePolicy,
  serializeCaptureFile,
} from '../adapters';
import { CaptureEnvironment, browserEnvironment } from './environment';
import { bindShortcuts } from './shortcuts';

/**
 * Module state on purpose: the probes patch process-wide globals, so there
 * can only ever be one capture. A second install would wrap the wrappers and
 * record everything twice.
 */
let activeSession: CaptureSession | null = null;

/** The session of the capture that is on right now, if any (a controller's while it is on). */
export function getActiveCaptureSession(): CaptureSession | null {
  return activeSession;
}

/**
 * The v1 entry point: installs capture and returns its session, or returns
 * the session of the capture already on. Call it as early as possible —
 * before bootstrap — so startup requests and sockets are captured too.
 *
 * Throws only for an invalid policy, and does so before anything is patched.
 * After that it never throws: a probe that cannot install (a browser without
 * `WebSocket`, say) is skipped and recorded as a `capture` error, so the
 * other probes still run and the exported file says what is missing.
 *
 * It is a controller's session: `dispose()` turns that capture off for good,
 * chords included (v1), since nobody else holds the controller (C-2, C-11).
 */
export function installDebugCapture(
  options: DebugCaptureOptions = {},
  env: CaptureEnvironment = browserEnvironment(),
): CaptureSession {
  return activeSession ?? createController(options, env, true).session;
}

/**
 * C-2 (HLD §6.4, `FR-ACT-09`): capture that turns off and on without losing
 * anything. One recorder for the controller's life, so the buffer, `seq`,
 * request ids and socket ids survive `stop()` / `start()`; one session
 * object, so the Angular and React seams that hold it (and check `active`)
 * keep working. Installs at once, unless another capture is already on —
 * then it stays off and records why.
 *
 * 2.2 (C-11, `D-37`): the chords are bound here, once, not with the probes,
 * so capture on / off, the note and the exports work while capture is off.
 * `dispose()` unbinds them.
 */
export function createCaptureController(
  options: DebugCaptureOptions = {},
  env: CaptureEnvironment = browserEnvironment(),
): CaptureController {
  return createController(options, env, false);
}

/** `disposeIsFinal`: `session.dispose()` is `controller.dispose()` — the v1 path, where nobody holds the controller. */
function createController(
  options: DebugCaptureOptions,
  env: CaptureEnvironment,
  disposeIsFinal: boolean,
): CaptureController {
  // Before anything is patched: a bad config fails loudly.
  const policy = resolvePolicy(options.policy);
  // Always built here from `policy`, so `session.policy` is the policy applied.
  const recorder = createRecorder(policy);
  const { clock } = env;
  const listeners: Array<(on: boolean) => void> = [];
  /** Changes made by a listener wait for the current one, so every listener sees them in order. */
  const queue: boolean[] = [];
  let notifying = false;
  /** Set while on: removes the probes. */
  let uninstall: (() => void) | null = null;
  let disposed = false;
  let unbind = (): void => undefined;

  const toJson = (): string =>
    serializeCaptureFile(
      buildCaptureFile(
        recorder.snapshot(),
        recorder.stats(),
        {
          capturedAt: new Date(clock.now()).toISOString(),
          page: env.page.location.href,
          userAgent: env.page.userAgent,
        },
        recorder.pending(),
      ),
    );

  const session: ControlledCaptureSession = {
    recorder,
    clock,
    policy,
    get active(): boolean {
      return uninstall !== null;
    },
    toJson,
    download(filename = defaultCaptureFileName(new Date(clock.now()))): void {
      downloadText(toJson(), filename, 'application/json', env.download);
    },
    async copy(): Promise<boolean> {
      try {
        return await copyText(toJson(), env.clipboard);
      } catch {
        // The contract: resolve `false`, never reject.
        return false;
      }
    },
    clear(): void {
      recorder.clear();
    },
    addNote(title: string, text = ''): void {
      // record() never throws; String() keeps a careless caller's value from becoming a `failed` count.
      recorder.record({ kind: 'note', t: clock.now(), title: String(title), text: String(text) });
    },
    addMessage(type: string, data: unknown = null, level: AppMessageLevel = 'info'): void {
      // FR-MSG-03: the host's messages are app activity, so capture off drops them (a note is kept).
      if (uninstall === null) return;
      try {
        recorder.record({ kind: 'app', t: clock.now(), type: String(type), level, data });
      } catch {
        // A type whose String() throws: nothing to record, and nothing thrown at the host.
      }
    },
    dispose(): void {
      if (disposeIsFinal) controller.dispose();
      else controller.stop();
    },
  };

  function changed(on: boolean): void {
    queue.push(on);
    if (notifying) {
      return;
    }
    notifying = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        for (const listener of listeners.slice()) {
          try {
            listener(next);
          } catch {
            // A broken listener (e.g. a panel) must not stop the switch or the other listeners.
          }
        }
      }
    } finally {
      notifying = false;
    }
  }

  const controller: CaptureController = {
    session,
    get on(): boolean {
      return uninstall !== null;
    },
    start(): void {
      if (uninstall || disposed) {
        return;
      }
      if (activeSession) {
        reportFailure(recorder, clock, 'capture not started', 'another capture is already on');
        return;
      }
      // Claimed first: a listener that calls installDebugCapture() while the
      // probes go in gets this session instead of patching everything twice.
      activeSession = session;
      uninstall = installCapture(recorder, env);
      changed(true);
    },
    stop(): void {
      const remove = uninstall;
      if (!remove) {
        return;
      }
      uninstall = null;
      if (activeSession === session) {
        activeSession = null;
      }
      remove();
      // A listener turned capture back on while the probes came off (it saw
      // an `end`): that start() already announced `true`, so `false` would lie.
      if (uninstall) {
        return;
      }
      // The probes end their own requests on dispose; this catches any they
      // could not, so no listener keeps a row that will never finish (C-1).
      for (const request of recorder.pending()) {
        recorder.endPending(request.id);
      }
      changed(false);
    },
    onChange(listener: (on: boolean) => void): Unsubscribe {
      listeners.push(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return;
        }
        subscribed = false;
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },
    shortcuts: null,
    dispose(): void {
      disposed = true;
      controller.stop();
      unbind();
    },
  };

  if (options.shortcuts !== false) {
    const keys: ShortcutConfig = Object.freeze({ ...DEFAULT_SHORTCUTS, ...options.shortcuts });
    const note = options.note ?? {};
    const text = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
    (controller as { shortcuts: ShortcutConfig | null }).shortcuts = keys;
    try {
      unbind = bindShortcuts(env.keyboard, [
        [keys.download, () => session.download()],
        [keys.copy, () => void session.copy()],
        [keys.clear, () => session.clear()],
        [keys.record, () => (controller.on ? controller.stop() : controller.start())],
        [keys.note, () => session.addNote(text(note.title, DEFAULT_NOTE.title), text(note.text, DEFAULT_NOTE.text))],
      ]);
    } catch (error) {
      reportFailure(recorder, clock, 'shortcuts failed to bind', error);
    }
  }

  controller.start();
  return controller;
}

/**
 * Installs every probe on `recorder`; returns the function that takes them
 * all off again, in reverse order.
 */
function installCapture(recorder: LiveRecorder & ProbeRecorder, env: CaptureEnvironment): () => void {
  const { clock } = env;
  const report = (message: string, error: unknown) => reportFailure(recorder, clock, message, error);

  const installers: ReadonlyArray<readonly [string, () => Probe]> = [
    ['console', () => installConsoleProbe(recorder, clock, env.console)],
    ['global-error', () => installGlobalErrorProbe(recorder, clock, env.errors)],
    ['xhr', () => installXhrProbe(recorder, clock, env.xhr)],
    ['fetch', () => installFetchProbe(recorder, clock, env.fetch)],
    ['websocket', () => installWebSocketProbe(recorder, clock, env.webSocket)],
  ];
  const probes: Probe[] = [];
  for (const [name, install] of installers) {
    try {
      probes.push(install());
    } catch (error) {
      report(`probe ${name} failed to install`, error);
    }
  }

  return () => {
    // Reverse order: the last patch applied is the first taken off.
    for (const probe of probes.slice().reverse()) {
      try {
        probe.dispose();
      } catch {
        // One stuck probe must not keep the others patched.
      }
    }
  };
}

/** Records the capture layer's own failure into its own buffer — the only place anyone will see it. */
function reportFailure(recorder: Recorder, clock: Clock, message: string, error: unknown): void {
  try {
    const isError = error instanceof Error;
    recorder.record({
      kind: 'error',
      source: 'capture',
      t: clock.now(),
      message: `${message}: ${isError ? error.message : String(error)}`,
      stack: isError && typeof error.stack === 'string' ? error.stack : null,
    });
  } catch {
    // Reporting a failure must not become a second one.
  }
}
