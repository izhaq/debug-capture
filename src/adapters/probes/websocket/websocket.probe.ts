import { Clock, EntryOrigin, Probe, ProbeRecorder, Recorder, WebSocketEntry, WebSocketEvent } from '../../../core';
import { bytesOf, toBase64, utf8Length } from './frame-data';
import { outsideZones } from './outside-zones';

/** The object whose `WebSocket` constructor the probe replaces — `globalThis` in the app, a plain object in specs. */
export interface WebSocketHost {
  WebSocket: typeof WebSocket;
}

type Payload = Pick<WebSocketEntry, 'opcode' | 'bytes' | 'data' | 'code' | 'origin'>;
type SendData = Parameters<WebSocket['send']>[0];
/** A v1 `Recorder` still works: it gets a per-install counter, as in v1 (C-2). */
type Sink = Recorder & Partial<ProbeRecorder>;

const NO_PAYLOAD: Payload = Object.freeze({ opcode: null, bytes: null, data: null, code: null });

function binary(bytes: Uint8Array): Payload {
  return { opcode: 'binary', bytes: bytes.byteLength, data: toBase64(bytes), code: null };
}

function text(value: string): Payload {
  return { opcode: 'text', bytes: utf8Length(value), data: value, code: null };
}

/**
 * Records every WebSocket connection's lifecycle and every frame in both
 * directions.
 *
 * `host.WebSocket` is replaced by a subclass of the original rather than a
 * wrapper function, so `instanceof WebSocket`, the static `CONNECTING` /
 * `OPEN` / `CLOSING` / `CLOSED` constants and every inherited member keep
 * working. rxjs `webSocket()` reads the global constructor each time a
 * subject connects — including every reconnect after an error — so each
 * attempt becomes its own socket with its own `socketId`, as long as the
 * probe is installed before the app creates its sockets.
 *
 * The probe only ever *adds* listeners: `onopen` / `onmessage` / `onerror` /
 * `onclose` belong to the app (rxjs assigns them) and are never read or set.
 *
 * Sockets created before install are not captured — there is nothing to
 * hook into after the fact.
 */
/** C-13 (2.5): resend on, and deliver to, a socket the app still has open (`FR-RPL-05`, `FR-RPL-06`). */
export interface WebSocketProbe extends Probe {
  send(socketId: number, data: string): boolean;
  deliver(socketId: number, data: string): boolean;
}

export function installWebSocketProbe(recorder: Sink, clock: Clock, host: WebSocketHost = globalThis): WebSocketProbe {
  const Original = host.WebSocket;
  /**
   * Dropped on dispose: listeners on sockets that stay open, and our subclass
   * left under someone else's, must not keep the recorder's buffer alive.
   */
  let sink: Sink | null = recorder;
  /** Only for a v1 recorder; a v2 recorder owns the counter, so ids survive stop/start. */
  let localSocketId = 0;
  /** Kept off the socket itself so the app never sees a stray property on its objects. */
  const socketIds = new WeakMap<WebSocket, number>();
  /** C-13: sockets by id until they close, for a developer's resend and deliver. */
  const live = new Map<number, WebSocket>();
  /** C-13: set only while `send()` below calls the socket's own `send`. */
  let replaying = false;
  /** C-13: the message event `deliver()` is dispatching right now. */
  let delivering: Event | null = null;

  /**
   * Runs capture bookkeeping so that it can never throw into the socket or
   * the app, and does nothing once disposed — which also silences sockets
   * that are still open, and Blob reads still in flight.
   */
  function guard(work: () => void): void {
    if (!sink) {
      return;
    }
    try {
      work();
    } catch {
      // Capture must never break the socket; the frame is simply not recorded.
    }
  }

  function emit(socketId: number, url: string, event: WebSocketEvent, t: number, payload: Payload): void {
    sink?.record({ kind: 'ws', t, socketId, url, event, ...payload });
  }

  /**
   * Records one `send` / `receive` frame. `t` is read here, at event time:
   * a Blob is read asynchronously, and the entry must say when the frame
   * moved, not when we finished reading it.
   */
  function recordFrame(
    socket: WebSocket,
    socketId: number,
    event: 'send' | 'receive',
    data: unknown,
    origin?: EntryOrigin,
  ): void {
    const t = clock.now();
    const url = socket.url;
    if (typeof data === 'string') {
      emit(socketId, url, event, t, { ...text(data), ...(origin ? { origin } : null) });
    } else if (data instanceof Blob) {
      data.arrayBuffer().then(
        (buffer) => guard(() => emit(socketId, url, event, t, binary(new Uint8Array(buffer)))),
        // Unreadable Blob: the frame still happened, so keep it, with its size.
        () =>
          guard(() => emit(socketId, url, event, t, { opcode: 'binary', bytes: data.size, data: null, code: null })),
      );
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      emit(socketId, url, event, t, binary(bytesOf(data)));
    } else {
      // send() converts anything else to a string (WebIDL), so record what it sent.
      emit(socketId, url, event, t, text(String(data)));
    }
  }

  function attach(socket: WebSocket): void {
    guard(() => {
      const socketId = sink?.nextSocketId ? sink.nextSocketId() : ++localSocketId;
      socketIds.set(socket, socketId);
      live.set(socketId, socket);
      const lifecycle = (event: WebSocketEvent, payload: () => Payload) => () =>
        guard(() => emit(socketId, socket.url, event, clock.now(), payload()));

      // Outside the app's zone: under zone.js each listener would otherwise be
      // one more task in Angular's zone — a change detection pass per frame.
      outsideZones(() => {
        socket.addEventListener(
          'open',
          lifecycle('open', () => NO_PAYLOAD),
        );
        socket.addEventListener(
          'error',
          lifecycle('error', () => NO_PAYLOAD),
        );
        socket.addEventListener('message', (event: MessageEvent<unknown>) =>
          guard(() => recordFrame(socket, socketId, 'receive', event.data, event === delivering ? 'mock' : undefined)),
        );
        socket.addEventListener('close', (event: CloseEvent) => {
          live.delete(socketId);
          guard(() =>
            emit(socketId, socket.url, 'close', clock.now(), {
              opcode: null,
              bytes: null,
              data: event.reason || null,
              code: event.code,
            }),
          );
        });
      });
    });
  }

  class CapturingWebSocket extends Original {
    constructor(...args: ConstructorParameters<typeof WebSocket>) {
      // Arguments pass through untouched: the browser validates and resolves the URL.
      super(...args);
      attach(this);
    }

    /**
     * Sends first, records after. A send that throws (e.g. InvalidStateError
     * while CONNECTING) never reached the wire, so it must not be recorded.
     */
    override send(data: SendData): void {
      super.send(data);
      const socketId = socketIds.get(this);
      if (socketId !== undefined) {
        guard(() => recordFrame(this, socketId, 'send', data, replaying ? 'replay' : undefined));
      }
    }
  }
  // For code (and people in a debugger) that inspect the constructor's name.
  Object.defineProperty(CapturingWebSocket, 'name', { value: 'WebSocket' });

  host.WebSocket = CapturingWebSocket;

  /** A captured socket the browser still has open; `null` after dispose. */
  function open(socketId: number): WebSocket | null {
    const socket = sink ? live.get(socketId) : undefined;
    return socket && socket.readyState === 1 ? socket : null;
  }

  return {
    name: 'websocket',
    send(socketId, data): boolean {
      const socket = open(socketId);
      if (!socket) return false;
      replaying = true;
      try {
        socket.send(data);
        return true;
      } catch {
        return false;
      } finally {
        replaying = false;
      }
    },
    deliver(socketId, data): boolean {
      const socket = open(socketId);
      if (!socket) return false;
      const event = new MessageEvent('message', { data });
      delivering = event;
      try {
        // The app's onmessage and listeners run as for a frame from the server; one that throws
        // is reported by the browser, as it would be for a real frame.
        socket.dispatchEvent(event);
        return true;
      } finally {
        delivering = null;
      }
    },
    dispose(): void {
      if (!sink) {
        return;
      }
      sink = null;
      live.clear();
      // If someone patched on top of us, leave their patch in place; with no
      // recorder left, our subclass is already a pass-through.
      if (host.WebSocket === CapturingWebSocket) {
        host.WebSocket = Original;
      }
    },
  };
}
