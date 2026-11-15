import type { CaptureController, HttpRequestDraft, ReplayApi } from '..';
import { createMockStore, MockStorage } from './mocks';

/** What `installReplay()` follows: the activation handle (`installDebugActivation()`), read structurally. */
export interface ReplayTarget {
  readonly controller: CaptureController | null;
  onChange(listener: (controller: CaptureController | null) => void): () => void;
}

/** Options for `installReplay()`. */
export interface ReplayOptions {
  /** FR-RPL-11: must be `true` — pass it only in a dev build (`allow: !environment.production`). */
  readonly allow: boolean;
}

/** The page, as far as this entry reads it (the default is `globalThis`). */
export interface ReplayScope {
  /** A getter that may throw (blocked site data). */
  readonly localStorage?: MockStorage;
  readonly console?: { warn(...args: unknown[]): void };
  readonly location?: { readonly href: string };
}

const installed = new WeakMap<object, ReplayApi>();

/**
 * 2.5 (`D-51`, S16-07): the dev-only replay and mock add-on. `target` is the
 * activation handle (the API follows each controller it switches on) or a
 * controller. Without `allow: true` it does nothing and logs one line.
 * Idempotent: the same target gets the same API. Never throws.
 */
export function installReplay(
  target: ReplayTarget | CaptureController,
  options: ReplayOptions,
  scope: ReplayScope = globalThis as ReplayScope,
): ReplayApi | null {
  try {
    if (options?.allow !== true) {
      scope.console?.warn(
        'debug-capture/replay is not installed: pass { allow: true }, in a development build only (FR-RPL-11).',
      );
      return null;
    }
    const known = installed.get(target);
    if (known) return known;
    const api = build(target, scope);
    installed.set(target, api);
    return api;
  } catch {
    return null;
  }
}

function build(target: ReplayTarget | CaptureController, scope: ReplayScope): ReplayApi {
  let storage: MockStorage | null = null;
  try {
    storage = scope.localStorage ?? null;
  } catch {
    // Blocked site data: the rules live for this page only.
  }
  const store = createMockStore(storage, scope.location?.href ?? 'http://localhost/');
  const isController = typeof (target as Partial<CaptureController>).setMockResolver === 'function';
  let current: CaptureController | null = isController
    ? (target as CaptureController)
    : (target as ReplayTarget).controller;

  const api: ReplayApi = {
    send(draft) {
      const controller = current;
      if (!controller) return Promise.resolve(null);
      // FR-RPL-04: a redacted value would be sent as the placeholder — the developer must fill it in.
      if (holds(draft, controller.session.policy.redactedValue)) return Promise.resolve(null);
      return controller.http.send(draft);
    },
    resend: (socketId, data) => current?.sockets.send(socketId, data) ?? false,
    deliver: (socketId, data) => current?.sockets.deliver(socketId, data) ?? false,
    mocks: {
      list: store.list,
      add: store.add,
      update: store.update,
      remove: store.remove,
      clear: store.clear,
      onChange: store.onChange,
    },
  };
  const attach = (controller: CaptureController | null): void => {
    current = controller;
    if (!controller) return;
    controller.replay = api;
    controller.setMockResolver(store.resolve);
  };
  attach(current);
  if (!isController) (target as ReplayTarget).onChange(attach);
  return api;
}

function holds(draft: HttpRequestDraft, redacted: string): boolean {
  return (
    (draft.body !== null && draft.body.includes(redacted)) ||
    Object.values(draft.headers).some((value) => String(value).includes(redacted))
  );
}
