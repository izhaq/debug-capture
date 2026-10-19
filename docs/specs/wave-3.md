# Wave 3 — plan

Source of truth: `docs/design/HLD.md` (Draft 0.5). Specs:
[S-05](05-http-view/spec.md) · [S-06](06-ws-view/spec.md) ·
[S-07](07-console-view/spec.md) · [S-08](08-frame/spec.md).
Built on wave 2 (PR #70, merged): the model (P1), the UI blocks (P2), the
loader (P5) and a placeholder frame (P4).

## Branches

```
claude/air-gapped-debug-logging-zkn1nr   integration — only the owner merges into it
└── claude/dc-v2-wave3                   wave-3 branch — one PR → integration at the end
    ├── claude/dc-v2-w3-specs            step 0: this plan and the four specs (docs)
    ├── claude/dc-v2-w3-contract         step 1: contract PR (orchestrator)
    ├── claude/dc-v2-w3-08-frame         S-08   PR → wave3   (first track)
    ├── claude/dc-v2-w3-05-http          S-05   PR → wave3
    ├── claude/dc-v2-w3-06-ws            S-06   PR → wave3
    └── claude/dc-v2-w3-07-console       S-07   PR → wave3
```

Track PRs merge into the wave branch with a **merge commit**, after the
orchestrator re-runs `npm run check` on the PR head and reads the diff.

## Steps

```
0  specs (this file + 05…08)               → owner glance
1  contract PR (below) + size measurement  → owner decides the budgets (R1, R2)
2  S-08 first (the frame the views mount in), then S-05, S-06, S-07 — at most two at a time
3  S-08 fresh-context review → fixes → confirmation; whole-wave review of the seams
4  one PR claude/dc-v2-wave3 → integration; the owner merges
```

## Step 1 — the contract PR (orchestrator, before any track)

| # | What | Where |
|---|---|---|
| C3-1 | **View interface** (below) and three stub views, so every track codes against names that exist | `src/panel/views/view.ts`, `views/index.ts`, `views/{http,ws,console}/index.ts` (stubs) |
| C3-2 | **`panelRoot: HTMLElement`** in `MountPanelUiOptions`; the loader passes its `.dcp-root`, so P4 stops looking it up by class. Update S02-09. | `src/panel/app/mount-panel-ui.ts`, `src/panel/loader.ts`, `docs/specs/02-panel-loader/spec.md` |
| C3-3 | **Stylesheet contract** (below) | `view.ts` doc comment, this file |
| C3-4 | **HTTP order (`D-18`, R3):** `selectHttpRows` returns **start order** (`t`, then `seq`), pending rows in their place; `PanelState.httpSort: HttpSort \| null`; `store.setHttpSort(key)` cycles asc → desc → `null`. Filters apply on top. | `src/panel/model/**` |
| C3-5 | **Virtual list:** sortable header cells (`aria-sort`, click / Enter / Space) and the "↓ N new" follow button (`FR-BAR-02`). Exact names are fixed in the PR and copied into "Names fixed now" before a track starts. | `src/panel/ui/virtual-list/**` |
| C3-6 | **Measure the UI chunk** (`npm run build && npm run size`, list what is in it) and ask the owner for the `NFR-SIZE-01` budgets (R1: UI chunk, R2: loader) | — |

The contract PR raises `test/unit/spec-floor.json` to its new count.

## Names fixed now (so tracks never wait for each other)

**View interface — `src/panel/views/view.ts` (P3; P4 may import P3):**

```ts
/** What the frame gives each view. */
export interface ViewDeps {
  readonly document: Document;
  /** The panel's shadow root: sinks (`copyText(text, root)`, `download(root)`) and popovers live inside it. */
  readonly root: ShadowRoot;
  readonly source: PanelDataSource;
  readonly store: PanelStore;
  readonly settings: ViewSettings;
  /** A panel failure: counted in the status bar (§4.11). Never throws, never logs. */
  report(error: unknown): void;
}

export interface ViewSettings {
  readonly time: TimeFormat;              // 'clock' | 'relative' (P1)
  readonly rowHeight: 20 | 22 | 26;       // Small / Normal / Large (§5.3)
  readonly dock: 'bottom' | 'right';      // where the detail pane goes (§4.6)
}

export interface PanelView {
  readonly element: HTMLElement;
  /** Called by the frame's scheduler, at most once per frame, only while this view is visible. */
  update(state: PanelState): void;
  applySettings(settings: ViewSettings): void;
  /** `Ctrl+F` (§4.12). */
  focusFilter(): void;
  /** `Escape`: closes the view's innermost open thing; `true` if it did (§4.12). */
  handleEscape(): boolean;
  destroy(): void;
}

export type CreateView = (deps: ViewDeps) => PanelView;
```

**Exports from the P3 barrel** (added by C3-1 as stubs; each track fills its own folder):

| Name | File | Track |
|---|---|---|
| `createHttpView: CreateView`, `HTTP_VIEW_CSS: string` | `views/http/index.ts` | S-05 |
| `createWsView: CreateView`, `WS_VIEW_CSS: string` | `views/ws/index.ts` | S-06 |
| `createConsoleView: CreateView`, `CONSOLE_VIEW_CSS: string` | `views/console/index.ts` | S-07 |
| `VIEW_CSS: string` (shared view chrome: filter bar, detail header, detail body) | `views/view.ts` | contract |

**Stylesheet contract (C3-3):**

- The loader's sheet holds the `:host` lockdown and a default `.dcp-root` box
  (bottom, 40%). It stays as it is (no loader bytes spent).
- The frame **owns size and dock** by inline styles on `panelRoot`
  (`el.style.x =` — allowed, `AGENTS.md` rule 11); inline styles win over the
  loader's default.
- The frame builds **one** UI sheet with
  `createThemeSheet(doc, [FRAME_CSS, VIEW_CSS, HTTP_VIEW_CSS, WS_VIEW_CSS, CONSOLE_VIEW_CSS])`
  and **appends** it: `root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]`.
  It never replaces the list, and removes only its own sheet on `unmount()`.

**Panel CSS — class names shared across tracks (prefix `dcp-`):**

| Class | Owner of the look | Used by |
|---|---|---|
| `dcp-root`, tokens, badges, `dcp-match`, `dcp-row*` | wave 2 (P2) | all |
| `dcp-view`, `dcp-filter-bar`, `dcp-detail`, `dcp-detail-header`, `dcp-detail-body` | contract (`VIEW_CSS`) | S-05, S-06, S-07 |
| `dcp-frame`, `dcp-titlebar`, `dcp-toolbar`, `dcp-banner`, `dcp-statusbar`, `dcp-resize` | S-08 (`FRAME_CSS`) | S-08 |
| `dcp-http-*` / `dcp-ws-*` / `dcp-console-*` | the view's track | that track only |

## Tracks

| Track | Brief | Owns (paths under `packages/debug-capture/`) |
|---|---|---|
| 08 Frame | `08-frame/prs/08-frame.md` | `src/panel/app/**`; `src/panel/loader.ts`, `loader-styles.ts` (fullscreen re-raise only); `test/hostile-host/**` except `server.mjs`; `test/e2e/panel-frame.spec.mjs`; `test/e2e/panel-hostile-host.spec.mjs`, `panel-zone.spec.mjs` (switch to the real controller) |
| 05 HTTP | `05-http-view/prs/05-http.md` | `src/panel/views/http/**`; `test/e2e/panel-http.spec.mjs` |
| 06 WebSocket | `06-ws-view/prs/06-ws.md` | `src/panel/views/ws/**`; `test/hostile-host/server.mjs` (a WebSocket echo, no new dependency); `test/e2e/panel-ws.spec.mjs` |
| 07 Console | `07-console-view/prs/07-console.md` | `src/panel/views/console/**`; `test/e2e/panel-console.spec.mjs` |

Nobody else edits `package.json`, `package-lock.json` (no new dependencies),
`src/panel/model/**`, `src/panel/ui/**`, `views/view.ts`, `views/index.ts`
(after the contract PR), the floors (the orchestrator raises them at each
merge), `AGENTS.md`, `README.md`, `docs/**`. A track that needs one of them
asks the orchestrator, who makes a small PR into the wave branch.

A view track needs pages that make traffic in the hostile host: it adds them
**inside its own e2e spec** (`page.evaluate`) — the fixture files belong to 08.

## Merge order

Contract → 08 → 05 → 06 → 07 (06 and 07 may run together). After each merge
the orchestrator runs `npm run check` on the wave branch and raises the floors.

## Reviews

- Each track: the orchestrator re-runs every check on the head and reads the diff.
- **S-08:** fresh-context adversarial review (`AGENTS.md` rule 28) — given only
  the diff, the spec and HLD §6.7 — then a fix round and a confirmation review
  of the fix commits only.
- S-05 … S-07: a review only if something looks risky (copy, cURL, bodies).
- End: one review of the whole wave focused on the **seams** (view interface,
  scheduler, stylesheet, storage), a fix round, then the wave PR.

## Risks

| ID | Risk | Plan |
|---|---|---|
| R1 | UI chunk 22,695 / 25,600 B with only the placeholder — ~2.9 kB for three views and the frame | Measure in C3-6; owner decides the budget before step 2 |
| R2 | Loader 4,041 / 4,096 B — 55 B left; `panelRoot` and the fullscreen listener touch it | Trim, or owner raises the 4 kB budget |
| R3 | HTTP order not in the model yet | C3-4 |
| R4 | Fullscreen must be proven | S-08 e2e: `requestFullscreen()` → launcher and panel on top and clickable; modal `<dialog>` → banner |

## Status

| Step / track | PR | State |
|---|---|---|
| 0 specs | — | in owner review |
| 1 contract | — | not started |
| 08 | — | not started |
| 05 | — | not started |
| 06 | — | not started |
| 07 | — | not started |

