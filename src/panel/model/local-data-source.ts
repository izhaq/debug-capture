import { CaptureController, copyText, defaultCaptureFileName, downloadText } from '../..';
import { PanelDataEvent, PanelDataSource } from './panel-data-source';

/**
 * The sinks the local data source uses, injectable for specs. Both put their
 * temporary node (the copy fallback's textarea, the download link) inside
 * `root`, the panel's shadow root — never the host page (C-5, `ISO-04`).
 */
export interface LocalDataSourceDeps {
  /** Resolves `true` when copied. May reject: the data source turns that into `false`. */
  readonly copyText?: (text: string, root: ShadowRoot) => Promise<boolean>;
  readonly downloadText?: (text: string, filename: string, root: ShadowRoot) => void;
}

// TODO(wave-2 merge): once 01b's `SinkOptions` are in L5, pass the root:
//   copyText(text, undefined, { root })
//   downloadText(text, filename, 'application/json', undefined, { root })
// Until then the L5 sinks put their temporary node in `document.body`.
const defaultCopyText = (text: string, _root: ShadowRoot): Promise<boolean> => copyText(text);
const defaultDownloadText = (text: string, filename: string, _root: ShadowRoot): void => downloadText(text, filename);

/**
 * The `PanelDataSource` for a panel on the same page as the capture (§6.4),
 * built only on the `CaptureController` contract. P4 builds it on mount;
 * nothing else in the panel sees the controller.
 */
export function createLocalDataSource(controller: CaptureController, deps: LocalDataSourceDeps = {}): PanelDataSource {
  const session = controller.session;
  const recorder = session.recorder;
  const copy = deps.copyText ?? defaultCopyText;
  const download = deps.downloadText ?? defaultDownloadText;

  return {
    snapshot: () => recorder.snapshot(),
    pending: () => recorder.pending(),
    stats: () => recorder.stats(),
    capacity: () => session.policy.maxEntries,
    redactedValue: () => session.policy.redactedValue,

    subscribe(listener) {
      // Isolated here, not left to the recorder: a view bug must never reach
      // the recorder or the host (ISO-12, NFR-REL-01).
      const emit = (event: PanelDataEvent): void => {
        try {
          listener(Object.freeze(event));
        } catch {
          // Swallowed on purpose; the panel's own error count is P4's job.
        }
      };
      const offs = [
        recorder.onEntry((entry) => emit({ type: 'entry', entry })),
        recorder.onPending((event) =>
          emit(
            event.type === 'start'
              ? { type: 'pending-start', request: event.request }
              : { type: 'pending-end', id: event.id },
          ),
        ),
        recorder.onChange((change) =>
          emit(change.type === 'cleared' ? { type: 'cleared' } : { type: 'stats', stats: recorder.stats() }),
        ),
        controller.onChange((on) => emit({ type: 'capture', on })),
      ];
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        for (const off of offs) {
          try {
            off();
          } catch {
            // Keep removing the others.
          }
        }
      };
    },

    clear: () => session.clear(),
    exportJson: () => session.toJson(),

    download(root) {
      try {
        // The session's clock, not the wall clock: the same time the entries carry.
        download(session.toJson(), defaultCaptureFileName(new Date(session.clock.now())), root);
      } catch {
        // A refused download must not throw into the host (NFR-REL-01); nothing was saved, nothing else to undo.
      }
    },

    async copyText(text, root) {
      try {
        return await copy(text, root);
      } catch {
        return false;
      }
    },

    capture: {
      get on(): boolean {
        return controller.on;
      },
      start: () => controller.start(),
      stop: () => controller.stop(),
    },
  };
}
