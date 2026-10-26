# S-14 — Custom messages (release 2.3)

HLD rows: §9.1 S-14, §2.1c, §3.12 (`FR-MSG-01…08`), §6.4, §6.5 `C-12`, decisions `D-46`, `D-47`,
`D-21`. Depends on S-13 (and #112, the DBG button on `?debug=1`). Source of truth:
[`../../design/HLD.md`](../../design/HLD.md).

## Goal

The host app sends its own messages — a type name, a level and any JSON data — through the
handle it already holds. They are kept in the buffer, shown in Console (App chip) and exported.
Sent while the tool is off, they are dropped. Owner decisions 2026-10-26 (`D-46`).

```ts
const debug = installDebugActivation();
debug.message('order-saved', { id: 42, total: 99.5 });
debug.message('payment-failed', { code: 'E17' }, 'error');   // a problem
```

Three code PRs after this docs PR: **S-14a core**, **S-14b panel**, **S-14c app**.

## Requirements — S-14a (core and the activation handle)

| ID | Requirement | HLD |
|---|---|---|
| S14-01 | Contract: `AppMessageLevel`, `AppMessageEntry` (`kind: 'app'`, `type`, `level`, `data: JsonValue`), in `CaptureEntry` and `EntryDraft` (draft `data: unknown`); `APP_MESSAGE_LEVELS`. | C-12, FR-MSG-01 |
| S14-02 | Recorder: `data` through `toJsonSafe` with the policy (as log args); `type` through `redactFreeText` (as a note title); a level that is not one of the three becomes `info`. | FR-MSG-04 |
| S14-03 | `ControlledCaptureSession.addMessage(type, data?, level?)`: records only while capture is on (`session.active`); `String(type)`; never throws. | FR-MSG-01, FR-MSG-03 |
| S14-04 | `isProblemEntry`: true for an app message with level `error`, false for `info` / `warn`. | FR-MSG-06, C-8 |
| S14-05 | The export holds app messages as entries (`sequence`, `time`, `kind: 'app'`, `type`, `level`, `data`); `schemaVersion` 2. | FR-MSG-07 |
| S14-06 | `DebugActivationHandle.message(type, data?, level?)`: forwards to the loaded session; a no-op before switch-on, while loading and after turn-off; never throws. Activation ≤ 1,536 B. | FR-MSG-02, FR-MSG-03, FR-MSG-08 |
| S14-07 | Until S-14b, the panel model leaves `app` entries out of every list (no row, no count), so the panel keeps compiling and behaving. Version `2.3.0-alpha.0`. | — |

## Requirements — S-14b (panel)

| ID | Requirement | HLD |
|---|---|---|
| S14-08 | `DebugPanelHandle.message(…)` forwards to `controller.session.addMessage`; the inert handle's is a no-op. Loader ≤ 5,632 B. | FR-MSG-02 |
| S14-09 | Console rows for app messages: level icon, the word `app`, then `type` and a one-line `data` preview as the message; detail: type, level, time, `data` as a JSON tree. | FR-MSG-05 |
| S14-10 | The Console level chip group gains **App**: with no chip chosen everything shows; with chips chosen, app messages show only when App is chosen (level chips never hide them, App never hides others). Stored with the other chips. Search covers `type` and `data`. | FR-MSG-05 |
| S14-11 | e2e: `message()` from the host on the hostile host — the row, the detail, the App chip, an `error` one in the badge, the export; dropped while capture is off. UI ≤ 45,056 B; perf green. Version `2.3.0-alpha.1`. | FR-MSG-03…08 |

## Requirements — S-14c (playground app)

| ID | Requirement | HLD |
|---|---|---|
| S14-12 | The app takes `vendor/debug-capture-2.3.0-alpha.1.tgz` and exports `debugMessage(type, data?, level?)` from `src/app/features/debug-panel/` (forwards to the activation handle). `docs/debug-panel.md`: how to send a message. The four app checks pass. | FR-MSG-02 |

## Out of scope

A queue for messages sent while off (`D-46`: dropped). A separate tab. Messages from other
windows. S-12.

## Traceability

| MUST (2.3) | Proved by | PR |
|---|---|---|
| FR-MSG-01, 03, 04 | `install-debug-capture.spec.ts`, `recorder` specs | S-14a |
| FR-MSG-02 | `activate.spec.ts` (S-14a), `loader.spec.ts` (S-14b), app spec (S-14c) | S-14a…c |
| FR-MSG-05 | selectors / console view specs; e2e | S-14b |
| FR-MSG-06 | `problem-rule.spec.ts`; e2e badge | S-14a, S-14b |
| FR-MSG-07 | serializer / install specs; e2e export | S-14a, S-14b |
| FR-MSG-08 | `npm run size` | all |
