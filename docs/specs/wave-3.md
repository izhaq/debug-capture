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
1  contract PR (below) + size measurement  → owner decides the loader budget if needed (R2); UI chunk is 40 kB (D-25)
2  S-08 first (the frame the views mount in), then S-05, S-06, S-07 — at most two at a time
3  S-08 fresh-context review → fixes → confirmation; whole-wave review of the seams
4  one PR claude/dc-v2-wave3 → integration; the owner merges
```

## Step 1 — the contract PR (orchestrator, before any track)

| # | What | Where |
|---|---|---|
| C3-1 | **View interface** (below) and three stub views, so every track codes against names that exist | `src/panel/ui/view-contract.ts` (types), `src/panel/views/view.ts` (`VIEW_CSS`), `views/index.ts`, `views/{http,ws,console}/index.ts` (stubs) |
| C3-2 | **`panelRoot: HTMLElement`** in `MountPanelUiOptions`; the loader passes its `.dcp-root`, so P4 stops looking it up by class. Update S02-09. | `src/panel/app/mount-panel-ui.ts`, `src/panel/loader.ts`, `docs/specs/02-panel-loader/spec.md` |
| C3-3 | **Stylesheet contract** (below) | `view.ts` doc comment, this file |
| C3-4 | **HTTP order (`D-18`, R3):** `selectHttpRows` returns **start order** (`t`, then `seq`), pending rows in their place; `PanelState.httpSort: HttpSort \| null`; `store.setHttpSort(key)` cycles asc → desc → `null`. Filters apply on top. | `src/panel/model/**` |
| C3-5 | **Virtual list:** sortable header cells (`aria-sort`, click / Enter / Space) and the "↓ N new" follow button (`FR-BAR-02`). Exact names are fixed in the PR and copied into "Names fixed now" before a track starts. | `src/panel/ui/virtual-list/**` |
| C3-6 | **Measure the UI chunk** (`npm run build && npm run size`, list what is in it) and report the numbers; the UI chunk budget is already 40 kB (`D-25`); ask the owner only about the loader (R2) | — |

The contract PR raises `test/unit/spec-floor.json` to its new count.

## Names fixed now (so tracks never wait for each other)

**View interface — `src/panel/ui/view-contract.ts` (P2, types only; re-exported by the P3 barrel):**

The types sit in P2, not in `views/view.ts`: a track's folder (`views/http/`…)
may import only its own directory and the P2 barrel (`lint:layers` rule 4), so
P2 is the one place every track can reach (contract PR finding). `views/view.ts`
keeps `VIEW_CSS` and the stylesheet contract.

```ts
/** What the frame gives each view. */
export interface ViewDeps {
  readonly document: Document;
  /** The panel's shadow root: sinks (`copyText(text, root)`, `download(root)`) and popovers live inside it. */
  readonly root: ShadowRoot;
  readonly source: PanelDataSource;
  readonly store: PanelStore;
  readonly settings: ViewSettings;
  /** The frame's once-per-frame scheduler, outside Angular's zone (ISO-09): the virtual list's `requestFrame`. */
  requestFrame(callback: () => void): void;
  /** The frame's timer, outside Angular's zone: the search box's `schedule` (debounce). */
  readonly schedule: Schedule;
  /** A panel failure: counted in the status bar (§4.11). Never throws, never logs. */
  report(error: unknown): void;
}

export interface ViewSettings {
  readonly time: TimeFormat;              // P1: { mode: 'clock', utcOffsetMinutes } | { mode: 'relative', origin }
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

`requestFrame` and `schedule` were added in the contract PR (the handoff's
"a scheduler" in deps): the virtual list and the search box need the frame's
scheduler, outside Angular's zone, and P3 may not reach for globals.

**HTTP order and sort (C3-4, `D-18`; P1 model, `src/panel/model/`):**

- `selectHttpRows(state)` returns **start order**: by `t` (an entry's `t` is
  its start time, like a pending row's), so a finished request lands where its
  pending row was. Equal times: finished rows by `seq`, then pending rows by id.
- `PanelState.httpSort: HttpSort | null` — `null` = start order.
  `HttpSort = { key: HttpSortKey; dir: 'asc' | 'desc' }`,
  `HttpSortKey = 'time' | 'method' | 'status' | 'name' | 'type' | 'size' | 'duration'`
  (the seven columns, §5.6).
- `store.setHttpSort(key)`: a new column → ascending; the same column →
  descending → `null` (start order). One notify per call.
- Filters and search apply on top of the sort; keyboard moves walk the sorted,
  filtered rows. The sort is **not remembered** (resets on reload, `D-20`).
- Sort rules:

| Key | Sorts by |
|---|---|
| `time` | start time (`t`) |
| `method` | the method text (upper-case already) |
| `status` | the number; **Failed / Aborted / Timeout** (no number shown — also an abort that kept a code) go after the numbered rows and before pending rows |
| `name` | the shown Name (`httpName(url)`: last path segment + query), ignoring upper and lower case |
| `type` | `fetch` / `xhr` |
| `size` | `bytes` |
| `duration` | `durationMs` |

- **Rows with no value** (pending rows on Status, Size, Duration; a finished
  row whose Size or Duration shows `—`) go **last, in both directions**.
- **Ties keep start order**, in both directions; so do the rows inside the
  "no number" and "no value" groups.

**Virtual list additions (C3-5; P2, `src/panel/ui/virtual-list/`):**

| Name | What |
|---|---|
| `VirtualListColumn.sortable?: boolean` | the header becomes a native `<button>` (`dcp-vlist__sort`); the sortable headers are **one tab stop** (ArrowLeft / ArrowRight / Home / End move between them) |
| `VirtualListOptions.onSort?(columnKey: string)` | a click, or Enter / Space (native button keys), on a sortable header. The list reorders nothing: the caller calls `store.setHttpSort`, then `setItems` and `setSort` |
| `VirtualList.setSort(sort: VirtualListSort \| null)` | `aria-sort="ascending"` / `"descending"` on that header and a CSS arrow (alt text `""`); `null` clears. `VirtualListSort = { key: string; dir: 'asc' \| 'desc' }` — `HttpSort` fits it as is |
| `VirtualListOptions.follow?: boolean` | builds `VirtualList.followButton` |
| `VirtualList.followButton: HTMLButtonElement \| null` | the "↓ N new" button (`dcp-btn dcp-vlist__follow`). It lives **outside** the grid (a grid owns only rows): append it next to `element` inside a `dcp-list-pane`; it places itself bottom-right, 8 px in (§5.7) |
| `VirtualList.setNewCount(count: number)` | N on "↓ N new". Shown while the list is not at its end and N > 0; a click scrolls to the end and focuses the list. Reset N to 0 when `onScrollChange` reports `true` |

Who counts N: the view (or the frame) counts its list's new rows since
following stopped (e.g. new entries of its kind, by `seq`); the list only
shows the number.

**Exports from the P3 barrel** (added by C3-1 as stubs; each track fills its own folder):

| Name | File | Track |
|---|---|---|
| `createHttpView: CreateView`, `HTTP_VIEW_CSS: string` | `views/http/index.ts` | S-05 |
| `createWsView: CreateView`, `WS_VIEW_CSS: string` | `views/ws/index.ts` | S-06 |
| `createConsoleView: CreateView`, `CONSOLE_VIEW_CSS: string` | `views/console/index.ts` | S-07 |
| `VIEW_CSS: string` (shared view chrome: filter bar, list pane, detail header, detail body) | `views/view.ts` | contract |

**Stylesheet contract (C3-3):**

- The loader's sheet holds the `:host` lockdown and a default `.dcp-root` box
  (bottom, 40%). It stays as it is (no loader bytes spent).
- The frame **owns size and dock** by inline styles on `panelRoot`
  (`el.style.x =` — allowed, `AGENTS.md` rule 11); inline styles win over the
  loader's default.
- The frame builds **one** UI sheet with
  `createThemeSheet(doc, [VIRTUAL_LIST_CSS, JSON_VIEWER_CSS, FRAME_CSS, VIEW_CSS, HTTP_VIEW_CSS, WS_VIEW_CSS, CONSOLE_VIEW_CSS])`
  and **appends** it: `root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]`.
  It never replaces the list, and removes only its own sheet on `unmount()`.

**Panel CSS — class names shared across tracks (prefix `dcp-`):**

| Class | Owner of the look | Used by |
|---|---|---|
| `dcp-root`, tokens, badges, `dcp-match`, `dcp-row*` | wave 2 (P2) | all |
| `dcp-view`, `dcp-filter-bar`, `dcp-list-pane`, `dcp-detail`, `dcp-detail-header`, `dcp-detail-body` | contract (`VIEW_CSS`) | S-05, S-06, S-07 |
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
| R1 | UI chunk 22,695 B with only the placeholder — the old 25,600 B budget left ~2.9 kB | **Decided: budget raised to 40 kB (`D-25`, `size-budgets.json` 40960).** C3-6 measured **24,086 B** after the contract (16.9 kB left); each track reports its own growth (estimate: frame ~5 kB, HTTP ~4–5, WS ~3, Console ~2) |
| R2 | Loader 4,041 / 4,096 B — 55 B left; `panelRoot` and the fullscreen listener touch it | `panelRoot` cost 5 B: **4,046 / 4,096, 50 B left** for the fullscreen listener (S-08). Trim, or owner raises the 4 kB budget |
| R3 | HTTP order not in the model yet | **Done** in C3-4 |
| R4 | Fullscreen must be proven | **Done in S-08:** drawn on top and live, but Chrome blocks clicks and focus outside the fullscreen element (like a modal), so a banner says so (`D-15` updated) |

**C3-6 — what the UI chunk holds** (minified bytes before gzip, by folder,
contract PR head): model 16.9 kB · ui (blocks) 15.4 kB · virtual list 11.7 kB ·
JSON viewer 11.3 kB · theme 10.5 kB · views 2.3 kB (`VIEW_CSS` + 3 stubs) ·
app 2.0 kB (placeholder). Total 70.8 kB min, **24,086 B** min+gzip; the
capture core stays in the shared chunk.

## Status

| Step / track | PR | State |
|---|---|---|
| 0 specs | #77, #78, #79 | done (D-24, D-25) |
| 1 contract | #81 | merged: C3-1…C3-6, 971 specs |
| 08 | #83 | merged: frame, toolbar, status bar, settings, layout, scheduler; hostile host on the real controller; `panel-frame` e2e; fresh-context review fixed + confirmed; 1017 specs, 24 e2e; loader 4,084 B, panel-ui 30,540 B |
| 05 | #84 | merged: HTTP list (start order, sort, status cells, follow count), filters, detail (sub-tabs, bodies, timing, Copy ▾ with cURL), removed-entry note; `panel-http` e2e with a real copy from the shadow root; 1043 specs, 26 e2e; panel-ui 34,043 B (+3.5 kB) |
| 05 fix | #85 | merged: the HTTP spec stage's `cleanup()` destroys every view (views left alive slowed later timing specs) |
| 06 spec | — | HLD `FR-WS-06` + `D-26` (WS detail Copy ▾, owner 2026-10-22); S-06 spec: Socket column in every mode, chosen connection kept, unread Blob shown as `[Blob N bytes]` |
| 06 | #89 | merged: connections + messages lists, direction / type chips + search, detail Message (JSON / Raw, base64 + hex, cut tail) and Info, Copy ▾ (D-26), follow count, removed note; WebSocket echo in the hostile-host server; `panel-ws` e2e with a real socket and a real copy; 1109 specs, 30 e2e; panel-ui 38,587 B (+2.8 kB) |
| 07 | #87 | merged: console list (levels, sources, more mark, follow count), level toggles + search, detail (argument trees, collapsed stack, removed note), grouping of repeats (S07-05); `panel-console` e2e; 1076 specs, 28 e2e; panel-ui 35,824 B (+1.8 kB) |









