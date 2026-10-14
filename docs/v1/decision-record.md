# Debug Capture — Intent and Decision Record

**Status:** Accepted 2026-10-12.
**For:** Engineering — anyone changing, reviewing or lifting `src/debug-capture/`
into another project.
**Context:** The app runs on air-gapped stations with no browser DevTools. When
something goes wrong there, today nobody can see the console, the failed
request or the socket traffic. This records what we build to fix that, what we
rejected, and why. Implementation plan: `specs/4-debug-capture/plan.md`.

---

## 1. What We're Building

- **Outcome:** A framework-free capture layer that records console output,
  uncaught errors, REST traffic (XHR + fetch) and WebSocket traffic into a
  bounded, redacted in-memory buffer, and exports it as one JSON file a
  developer can read.
- **In scope:** record + redact + bound + export; an optional Angular seam
  (`ErrorHandler` + DI token); wiring in `main.ts` / `AppModule`; keyboard
  shortcuts for download / copy / clear.
- **Out of scope (later work):** any on-screen panel (Network / Socket /
  Console tabs). The recorder exposes `onEntry()` so a panel can be added
  without changing the contract. Also out: an Angular `HttpInterceptor` — the
  XHR probe already sees every `HttpClient` request (Angular's
  `HttpXhrBackend` uses XHR), and adding one would mean editing the
  `provideHttpClient()` call that `provideAuth()` owns.
- **Environment:** Air-gapped, no DevTools. It must work in **production
  builds**, behind a flag: `?debug=1` in the URL, or `debug-capture=1` in
  `localStorage` (wired in PR 8). Without the flag nothing is patched.

---

## 2. Alternatives Considered

**eruda 3.4.3** (MIT, 21k★) — 488 kB raw / 147 kB gzip.
- Bundles chobitsu, which patches XHR, fetch and WebSocket at load and never
  restores them — there is no restore/unpatch code at all.
- Keeps every response body in a module-private `Map` that is set but never
  deleted; its own pre-enable buffer is an unbounded array. Memory grows for
  as long as the page lives.
- Captures WebSocket frames, but its Network panel never displays them.
- No bulk export. The npm package ships no LICENSE file.

**vConsole 3.15.1** (MIT, Tencent) — 280 kB raw / 76 kB gzip.
- Can restore its patches (`unMock()`) and bounds memory
  (`maxNetworkNumber`, default 1000).
- But: zero WebSocket capture, no bulk export, and no release since
  2023-06-01 (issue #718 "has maintenance stopped?" was closed without an
  answer).

**chii** (MIT) — the real Chrome DevTools frontend over a relay server. But an
unauthenticated relay is remote code execution in the user's session. Fine on
dev boxes only.

**Decision: build the capture layer ourselves.** It is needed under every
option: redaction, bounded memory, a real on/off and a file export are
impossible on a capture you don't own. Whether to add an on-screen panel — ours
or a library's, fed from our recorder — is a separate, later decision.

---

## 3. Architecture

Strict layers, one barrel (`index.ts`) each. **Each layer imports only the
barrel of the layer directly above it**, and every barrel re-exports the layer
above, so a layer gets everything from exactly one import path.

```
L1 contract   src/debug-capture/contract/        types + constants only    imports: nothing
L2 core       src/debug-capture/core/            pure logic, no globals    imports: ../contract
L3 adapters   src/debug-capture/adapters/        the only impure code      imports: core barrel
                probes/console  probes/global-error  probes/http
                probes/websocket  sinks
L4 install    src/debug-capture/install/         composition root          imports: ../adapters
L5 public     src/debug-capture/index.ts         export * from './install'
L6 angular    src/app/features/debug-capture/    DI token, ErrorHandler    imports: L5 + @angular/*, rxjs
L6 react      src/debug-capture/react/           React error callbacks     imports: L5 only, no packages
consumers (src/main.ts, src/app/app.module.ts) import the L6 barrel only
```

Import rules:

1. A file may import files in its own directory.
2. An `index.ts` may also import the `index.ts` of an immediate child
   directory — that is how aggregator barrels work.
3. A file may import the barrel of the layer directly above — the directory,
   never a file inside it.
4. Nothing else: no reaching two layers up, no sibling modules
   (`probes/http` must not import `probes/websocket`), no deep imports.
5. `src/debug-capture/**` has zero package imports.
6. `src/app/features/debug-capture/**` may import `@angular/*` and `rxjs`.
7. Anything else in `src/` imports only the L5 barrel or an L6 barrel
   (`src/app/features/debug-capture`, `src/debug-capture/react`), never deeper.

Type-only imports, re-exports and dynamic `import()` all count.

**Why:**
- **Portability.** `src/debug-capture/` can be copied into any project —
  Angular or not — because it imports no packages and nothing outside itself.
- **One auditable place touches globals.** Only L3 patches `console`, XHR,
  `fetch`, `WebSocket` and window events. A reviewer checking "what does this
  do to my page?" reads one directory.
- **Enforced, not hoped for.** A deep import compiles fine, so the rules are
  checked by `npm run lint:layers` (`scripts/check-debug-capture-layers.js`).

### React

In a React app the layer already captures everything that reaches the
window and the network. What it misses is the Angular seam's job: errors
React handles itself, with React's component stack. `src/debug-capture/react/`
fills that gap.

It is **React-shaped but React-free**: plain functions with exactly the
callback signatures React calls (React 19 `createRoot` error options, React 18
`componentDidCatch`). No `react` import, no new package.

**Why:**
- **This repo has no React** and must not get one; a React import would also
  break rule 5 and the "copy one folder" portability.
- **The signatures are all React needs.** React calls these callbacks as
  plain functions; matching their shape (taken from `@types/react-dom` and
  React's production build) is enough to plug in.
- **Same guarantees as the Angular seam:** record guarded, then always call
  the app's handler or React's own default, so the app behaves as before.
- **Inside `src/debug-capture/`**, not beside the Angular seam, so copying
  that one folder into a React project brings it along. The L5 barrel does
  not re-export it; a React app imports `src/debug-capture/react` directly.

---

## 4. Security

- **Redaction happens before storage, never at display.** The recorder applies
  the policy on the way into the buffer, so an exported file cannot contain
  anything the policy removed. `ignoreUrls` and `redactBodyUrls` match the
  original URL; the stored URL is the redacted one.
- **Default redactions:**
  - Headers: `authorization`, `proxy-authorization`, `cookie`, `set-cookie`,
    `x-api-key`, `x-auth-token`, `x-csrf-token`, `x-xsrf-token` — plus any
    header whose name matches a secret name below (`x-access-token`,
    `x-refresh-token`, `x-amz-signature`).
  - Secret names (`redactJsonKeys`): `password`, `passwd`, `secret`, `token`,
    `accesstoken`, `refreshtoken`, `apikey`, `authorization`, `clientsecret`,
    `idtoken`, `privatekey`, `sessionid`, `sessiontoken`, `csrftoken`,
    `xsrftoken`, `signature`.
- **Name matching ignores case, `_` and `-`** on both sides, so `accesstoken`
  matches `access_token`, `Access-Token` and `accessToken`.
- **A key is secret when it ends with a secret name**: `password` also covers
  `newPassword`, `confirm_password` and `userPassword`; `apikey` covers
  `x-api-key`; `signature` covers `X-Amz-Signature`. Names that only start
  with or contain one (`tokenCount`, `passwordPolicy`, `secretary`) are kept.
  As a consequence pagination keys such as `nextToken` are redacted too.
- **A secret value that is `null` or a boolean is kept** (and `undefined` in
  logged objects): it carries no secret, and `"[redacted]"` in its place would
  make a reader think a token was there.
- **What each part of an entry gets:**
  - **JSON** (request/response bodies, JSON WebSocket text frames, logged
    strings and error messages that are JSON; a leading byte-order mark is
    fine): secret keys at any depth, `{ name, value }` / `{ param, value }`
    pairs naming a secret, and URL parameters inside string values
    (`{"next":"…?access_token=[redacted]"}`). The JSON is redacted whole,
    then truncated; the other fields stay intact.
  - **Logged objects**: as JSON, plus `Map`s keyed by a secret name (Angular's
    `HttpHeaders` keeps its values in a `Map`; its pending changes are
    `{ name, value }` pairs). The secret property is never read.
  - **URLs** of HTTP and WebSocket entries: secret query and fragment
    parameter values, on the raw string so the rest stays byte for byte. `?`
    also separates parameters, so a nested URL (`?next=/cb?access_token=…`)
    cannot hide one; names are percent-decoded and split at brackets
    (`access_token[]`, `user[password]`); a value that percent-decodes to a
    secret parameter (`returnUrl=%2Fp%3Ftoken%3D…`) is replaced whole.
  - **Form bodies** (`application/x-www-form-urlencoded`, or no content-type:
    for a `URLSearchParams` body the browser adds the header after the probe
    saw the call), **non-JSON logged strings and error messages**: URL / form
    parameters as above, scanned after truncation (a parameter cut by
    truncation is gone anyway).
  - **Stacks** (`ErrorEntry.stack`, logged `Error`s): a stack starts with the
    message, so the raw message in it is replaced by the redacted one (when
    the stack holds the message in another form, only its frame lines are
    kept), then URL parameters are redacted after truncation.
- This app's login request body `{ username, password, mode, position }` is
  covered by the `password` key.
- **Not redacted** — there are no keys to match: non-JSON text frames such as
  socket.io `42["login",{…}]` or STOMP, NDJSON bodies, free text in error
  messages and stacks beyond JSON and URL parameters, and secrets under names
  that do not end with a listed one. OAuth `code` parameters are not redacted
  (the name is too generic); add `code` to `redactJsonKeys` if needed. Use
  `redactBodyUrls` for such endpoints.
- **Logged objects' getters run at log time** — copying an object means
  reading it. Secret properties are the exception: they are never read.
- **Stored entries are deeply frozen** as they are built, so a listener on
  `onEntry()` cannot change what a later export contains.
- **Exported files may still contain business data** (experiment values,
  usernames, URLs). Treat them as sensitive and hand them over the same way as
  any other internal data.

---

## 5. Memory and Performance

- **Ring buffer**, 5000 entries by default: the oldest entry is evicted.
- **Truncation**, 32 KiB by default (`maxBodyLength`), for bodies, frame
  data, URLs, header values, messages and stacks, with a marker.
- **JSON-safe cloning of log arguments** at record time: the buffer never
  holds live object references, so it cannot keep app objects alive.
- **A budget per log entry.** Depth (6) and width (100 items per level) limits
  alone do not bound the work: a graph whose levels share one child is cloned
  once per path — a 40-wide, 4-deep one took 490 ms and stored 33 MB. So all
  the arguments of one call share a budget of 1000 values
  (`MAX_CLONE_NODES`) and `maxBodyLength` characters of strings and keys;
  past it, values become `"[…]"` and the entry still stores. An object met
  again in the same call reuses its clone (still paying its cost), and
  listing more than 100 keys of an object costs one value per 10 keys — so
  big dictionaries shared by many rows are walked once.
- **Parameter redaction is bounded by `maxBodyLength`**, not by the input:
  form bodies, messages and stacks are truncated first, and in JSON only the
  string values that land inside the kept part are scanned. A 10 MB form body
  costs about as much as a short one.
- **Secret-name decisions are cached** per key (up to 2000 keys per policy),
  so busy JSON frames pay one lookup per key.
- **A socket's URL is redacted once**, not per frame: the recorder remembers
  the last URL it processed.
- **Optional `sample()`** in the policy to drop drafts from chatty sockets —
  the system-experiments grid streams many frames per second. **No sampling
  by default**; turn it on only if a capture proves too noisy.
- **Lean:** it ships in the production bundle (initial total 800.5 kB against
  an 850 kB warning budget), so the target is the whole layer under 15 kB raw.

---

## 6. Known Limitations

- Requests are recorded **on completion** (load, error, abort or timeout). A
  request that never finishes does not appear.
- Sockets created **before install** are not captured.
- Streaming response bodies (`text/event-stream`) and binary `fetch` bodies
  are not read.
- Pages that load **before the flag is set** capture nothing — set the flag,
  then reload.
- Redaction is by name only: secrets in non-JSON text frames (socket.io,
  STOMP), NDJSON bodies, free-text messages, or under names that do not end
  with a listed one are kept (§4). Pagination keys like `nextToken` are
  redacted (§4).
- Logging an object runs its getters at log time (except secret ones).
- A log call past its budget keeps only its first 1000 values and
  `maxBodyLength` characters; the rest read `"[…]"`.
- OAuth `code` parameters are not redacted (§4).
- Text `fetch` bodies are read up to 1,048,576 characters; after that the
  capture stops and says so.
- Binary WebSocket frames are base64-encoded before `sample()` runs, so
  sampling saves memory but not that work. Text frames are not affected.
- `recorder.onEntry()` listeners for network entries run outside Angular's
  zone. A framework-free panel stays outside it too; only an Angular-component
  panel would need `NgZone.run`.

---

## 7. Decisions Made

| # | Decision | Why |
|---|----------|-----|
| 1 | Build our own capture layer; no eruda / vConsole / chii | Redaction, bounded memory, real on/off and export need a capture we own (§2) |
| 2 | Framework-free core, Angular only in L6 | Portable to any project (§3) |
| 3 | Strict one-barrel layers, checked by `npm run lint:layers` | Deep imports compile; only a check keeps the layers honest (§3) |
| 4 | Redact before storage, with sensitive defaults | Nothing the policy removed can leak through an export (§4) |
| 5 | Ring buffer + truncation + JSON-safe clones | Memory stays bounded on long-running stations (§5) |
| 6 | Production builds, behind `?debug=1` / `localStorage` flag | The stations that need it run production builds (§1) |
| 7 | On-screen panel deferred | Separate decision; `onEntry()` keeps the door open (§1) |
| 8 | React adapter without React (L6 react) | React-shaped functions are all React needs; no dependency (§3) |
