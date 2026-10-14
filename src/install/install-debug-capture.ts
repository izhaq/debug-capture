import {
  CaptureSession,
  Clock,
  DEFAULT_SHORTCUTS,
  DebugCaptureOptions,
  Probe,
  Recorder,
  ShortcutConfig,
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

/** The session `installDebugCapture` created and that is not yet disposed, if any. */
export function getActiveCaptureSession(): CaptureSession | null {
  return activeSession;
}

/**
 * The composition root: resolves the policy, builds the recorder, installs
 * every probe, binds the export shortcuts and returns the session handle.
 * Call it as early as possible — before bootstrap — so startup requests and
 * sockets are captured too.
 *
 * Throws only for an invalid policy, and does so before anything is patched.
 * After that it never throws: a probe that cannot install (a browser without
 * `WebSocket`, say) is skipped and recorded as a `capture` error, so the
 * other probes still run and the exported file says what is missing.
 */
export function installDebugCapture(
  options: DebugCaptureOptions = {},
  env: CaptureEnvironment = browserEnvironment(),
): CaptureSession {
  if (activeSession) {
    return activeSession;
  }

  const policy = resolvePolicy(options.policy);
  const recorder = createRecorder(policy);
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

  const toJson = (): string =>
    serializeCaptureFile(
      buildCaptureFile(recorder.snapshot(), recorder.stats(), {
        capturedAt: new Date(clock.now()).toISOString(),
        page: env.page.location.href,
        userAgent: env.page.userAgent,
      }),
    );

  let active = true;
  let unbind = (): void => undefined;

  const session: CaptureSession = {
    recorder,
    clock,
    get active(): boolean {
      return active;
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
    dispose(): void {
      if (!active) {
        return;
      }
      active = false;
      unbind();
      // Reverse order: the last patch applied is the first taken off.
      for (const probe of probes.slice().reverse()) {
        try {
          probe.dispose();
        } catch {
          // One stuck probe must not keep the others patched.
        }
      }
      if (activeSession === session) {
        activeSession = null;
      }
    },
  };

  if (options.shortcuts !== false) {
    const keys: ShortcutConfig = { ...DEFAULT_SHORTCUTS, ...options.shortcuts };
    try {
      unbind = bindShortcuts(env.keyboard, [
        [keys.download, () => session.download()],
        [keys.copy, () => void session.copy()],
        [keys.clear, () => session.clear()],
      ]);
    } catch (error) {
      report('shortcuts failed to bind', error);
    }
  }

  activeSession = session;
  return session;
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
