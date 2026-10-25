import { CaptureEntry, CaptureStats, PendingRequest, Unsubscribe } from '../..';

/**
 * Where the panel's data comes from (HLD §6.4): this page now, another window
 * later (§6.9). The model and views never see a `CaptureSession` — only this —
 * so the separate window is a new data source, not a rewrite. S-03 builds the
 * local one from a `CaptureController`.
 */
export interface PanelDataSource {
  /** The stored entries, oldest first. Read on open, before `subscribe`. */
  snapshot(): readonly CaptureEntry[];
  /** C-1: requests in flight, oldest first. Read on open, before `subscribe`. */
  pending(): readonly PendingRequest[];
  stats(): CaptureStats;
  /** C-9: the buffer size now, shown as `1,284 / 5,000`; `Infinity` = No limit. */
  capacity(): number;
  /** C-3: `policy.maxEntries` — the Buffer setting's default (`FR-BUF-01`). */
  defaultCapacity(): number;
  /** C-9: a new buffer size (an integer ≥ 1 or `Infinity`); a `capacity` event follows. Never throws. */
  setCapacity(capacity: number): void;
  /** C-10: records a note now (`FR-NOTE-01`). Never throws. */
  addNote(title: string, text: string): void;
  /** C-3: `policy.redactedValue` — values equal to it are shown as redacted. */
  redactedValue(): string;
  subscribe(listener: (event: PanelDataEvent) => void): Unsubscribe;
  clear(): void;
  /** The whole buffer as a serialized `CaptureFile`. */
  exportJson(): string;
  /** C-5: saves `exportJson()`; the temporary `<a>` goes inside `root`, never the host page. */
  download(root: ShadowRoot): void;
  /** C-5: the fallback textarea goes inside `root`. Resolves `false` instead of rejecting. */
  copyText(text: string, root: ShadowRoot): Promise<boolean>;
  /** C-2: capture on/off without losing the buffer. */
  readonly capture: { readonly on: boolean; start(): void; stop(): void };
}

/** What a `PanelDataSource` tells its subscribers. Discriminated on `type`. */
export type PanelDataEvent =
  | { readonly type: 'entry'; readonly entry: CaptureEntry }
  /** C-1 */
  | { readonly type: 'pending-start'; readonly request: PendingRequest }
  /** C-1: finished, sampled out, failed, capped or stopped. */
  | { readonly type: 'pending-end'; readonly id: number }
  /** C-6 */
  | { readonly type: 'cleared' }
  /** C-6: `dropped` / `failed` changed. */
  | { readonly type: 'stats'; readonly stats: CaptureStats }
  /** C-2 */
  | { readonly type: 'capture'; readonly on: boolean }
  /** C-9: the buffer size changed; the store drops its oldest beyond it. */
  | { readonly type: 'capacity'; readonly capacity: number };
