# 11a — Core: resizable buffer, usage, notes

Spec: [`../spec.md`](../spec.md) (S11-01 … S11-06). Plan: [`../plan.md`](../plan.md).
Branch `claude/dc-v2-s11a-core` → one PR into `claude/air-gapped-debug-logging-zkn1nr`.

## Goal

The capture layer changes 2.1 needs: a buffer whose size changes live (No limit included),
O(1) usage numbers (entries, capacity, estimated bytes, problems), and the `note` entry kind
with `session.addNote()`.

## Owned paths

See the plan (S-11a rows).

## Public API (exact names)

```ts
// src/contract/capture-contract.ts
export interface NoteEntry extends CaptureEntryBase { readonly kind: 'note'; readonly title: string; readonly text: string }
export type CaptureEntry = LogEntry | HttpEntry | WebSocketEntry | ErrorEntry | NoteEntry;
// EntryDraft gains Omit<NoteEntry, 'seq'>
export interface BufferUsage { readonly entries: number; readonly capacity: number; readonly bytes: number; readonly problems: number }
export type RecorderChange = { type: 'cleared' } | { type: 'stats' } | { type: 'capacity' };
interface LiveRecorder { usage(): BufferUsage; setCapacity(capacity: number): void; /* + existing */ }
interface ControlledCaptureSession { addNote(title: string, text?: string): void; /* + existing */ }
export const ENTRY_COST_BYTES = 160;   // C-9 estimate: per entry, plus 2 B per character

// src/core/ring-buffer.ts
class RingBuffer<T> { get capacity(): number; setCapacity(capacity: number): T[]; /* push, toArray, clear, size as before */ }
```

## Behaviour

- `RingBuffer`: an array plus a head index; eviction moves the head; the dead prefix is cut
  off once it is at least 1,024 long and half the array (amortised O(1)). Capacity is an
  integer ≥ 1 or `Infinity` (constructor throws otherwise, as before; `setCapacity` throws
  too — the recorder validates first).
- `recorder.setCapacity`: ignores a bad value or the same value; evicts the oldest down to
  the new size, keeping `evicted`, `bytes` and `problems` right; then emits `capacity`.
- `usage().bytes`: weighed once when stored and again when it leaves (the same pure walk).
- Notes: `redactFreeText` on title and text (redacted JSON keys and URL parameters,
  truncated to `maxBodyLength`).
- `addNote` uses `recorder.record`, so a note is never lost to capture being off.
- Panel model: `byKind` drops `note` entries (no row anywhere) until S-11b.

## Required specs

`ring-buffer.spec.ts` (Infinity, setCapacity both ways, compaction keeps order),
`recorder.spec.ts` (setCapacity: evicts + stats + event once, ignores bad values, seq keeps
counting; usage: bytes and problems through push, evict, shrink, clear; note policing),
`problem-rule.spec.ts` (note is not a problem), `install-debug-capture.spec.ts` (addNote
on and off, in `toJson()`), `selectors.spec.ts` (a note shows in no list yet). Each red once.

## Verification

`npm run check`. Report spec counts, the core size against its budget.

## Out of scope

Anything in the panel UI or loader. Budgets.
