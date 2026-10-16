# Wave 2 — plan

Source of truth: `docs/design/HLD.md` (Draft 0.5). Specs:
[S-01](01-core-changes/spec.md) · [S-02](02-panel-loader/spec.md) ·
[S-03](03-panel-model/spec.md) · [S-04](04-ui-blocks/spec.md).
Built on S-00 (`00-foundation/`), whose contracts every track codes against.

## Branches

```
claude/dc-v2-s00-foundation           S-00 (PR #59, in owner review)
└── claude/dc-v2-wave2                wave-2 branch — the owner reviews this one
    ├── claude/dc-v2-w2-01a-core      S-01 track a   PR → wave2
    ├── claude/dc-v2-w2-01b-sinks     S-01 track b   PR → wave2
    ├── claude/dc-v2-w2-02-loader     S-02           PR → wave2
    ├── claude/dc-v2-w2-03-model      S-03           PR → wave2
    ├── claude/dc-v2-w2-04a-controls  S-04 track a   PR → wave2
    ├── claude/dc-v2-w2-04b-list      S-04 track b   PR → wave2
    └── claude/dc-v2-w2-04c-json      S-04 track c   PR → wave2
```

When S-00 is merged into the integration branch, the wave-2 branch merges it
in, and its PR goes to the integration branch.

## Tracks (all seven in parallel)

| Track | Brief | Owns (paths under `packages/debug-capture/`) |
|---|---|---|
| 01a Core | `01-core-changes/prs/01a-recorder-probes-controller.md` | `src/contract/**`, `src/core/**` (except `problem-rule*`), `src/adapters/probes/**`, `src/install/**` |
| 01b Sinks + problem rule | `01-core-changes/prs/01b-sinks-problem-rule.md` | `src/adapters/sinks/**`, `src/core/problem-rule.ts`, `src/core/problem-rule.spec.ts`, one export line in `src/core/index.ts` |
| 02 Loader | `02-panel-loader/prs/02-loader.md` | `src/panel/index.ts`, other files directly in `src/panel/`, `src/panel/app/**`, `test/hostile-host/**`, `test/e2e/panel-*`, `playwright.config.mjs` |
| 03 Model | `03-panel-model/prs/03-model.md` | `src/panel/model/**` |
| 04a Controls | `04-ui-blocks/prs/04a-builder-theme-controls.md` | `src/panel/ui/**` except `ui/virtual-list/**`, `ui/json-viewer/**`; `scripts/theme-check.mjs`; the `contrast` line of `package.json` |
| 04b Virtual list | `04-ui-blocks/prs/04b-virtual-list.md` | `src/panel/ui/virtual-list/**` |
| 04c JSON viewer | `04-ui-blocks/prs/04c-json-viewer.md` | `src/panel/ui/json-viewer/**` |

Nobody else edits `package.json`, `package-lock.json` (no new dependencies in
wave 2), `test/unit/spec-floor.json` (the orchestrator raises it at each
merge), `AGENTS.md`, `README.md`, `docs/**` (except the track's own spec notes
if asked).

## Names fixed now (so tracks never wait for each other)

**From L5 (S-01, available to every panel layer through the barrels):**

- `createCaptureController(options?: DebugCaptureOptions): CaptureController` (01a).
- `createRecorder(policy)` returns `LiveRecorder & ProbeRecorder` (01a).
- ~~`DebugCaptureOptions.recorder`~~ — removed after the S-01 review (see S01-07).
- `isProblemEntry(entry: CaptureEntry): boolean` (01b).
- `copyText(text, host?, options?: SinkOptions)`, `downloadText(text, filename, mimeType?, host?, options?: SinkOptions)` (01b).

Until a name is merged into the wave branch, a panel track **injects** it (a
parameter typed with the contract type) or uses a local stub marked
`// TODO(wave-2 merge)`; the orchestrator says when to switch.

**Panel CSS — class names shared across tracks (prefix `dcp-`):**

| Class | Owner of the look (CSS) | Used by |
|---|---|---|
| `dcp-root` (inner root; tokens live here) | 04a | 02, 04a |
| `dcp-badge`, `dcp-badge--redacted`, `--truncated`, `--pending` | 04a | 04b, 04c, views |
| `dcp-match` (search highlight) | 04a | 04b, views |
| `dcp-row`, `dcp-row--alt`, `--selected`, `--error`, `--warn` | 04b | views |
| `dcp-json-*` (`key`, `string`, `number`, `literal`, `placeholder`) | 04c | — |

Each P2 track exports its CSS as a string constant — 04a `CONTROLS_CSS` and the
theme, 04b `VIRTUAL_LIST_CSS`, 04c `JSON_VIEWER_CSS` — and 04a's
`createThemeSheet(doc, extraCss?: readonly string[])` composes them into the
one `CSSStyleSheet` (`ISO-04`, `ISO-05`). The P2 barrel (`ui/index.ts`, 04a)
re-exports the child barrels `./virtual-list` and `./json-viewer`; the
orchestrator adds those two lines when 04b / 04c merge.

## Merge order

01b first (small; unblocks `isProblemEntry` for 02 and 03), then 04a (tokens
and badge CSS), then the others as they finish. After each merge the
orchestrator runs `npm run check` on the wave branch and raises the spec floor.

## Reviews

- Each track: the orchestrator re-runs every check on the head and reads the diff.
- Fresh-context adversarial review (AGENTS rule 28): **S-01** (01a + 01b, the
  hot path and redaction), **S-02** (isolation), **S-04** (DOM safety and
  performance). Findings are fixed on the track branch before it merges.
- At the end: a review of the whole wave branch, a fix round, and a
  confirmation review — then one PR, wave branch → integration branch.

## Status

| Track | PR | State |
|---|---|---|
| 01a | — | started |
| 01b | #60, #62 | merged — `isProblemEntry`, sinks with `{ root }`; #62: copy can no longer hang (S-01 review) |
| 02 | — | started |
| 03 | #61 | merged — 459 specs; data source, store, selectors, format, body helpers, cURL |
| 04a | #63 | merged — builder, theme, icons, controls (S-04 review fixed) |
| 04b | #64 | merged — virtual list (S-04 review fixed; node budget → D-22) |
| 04c | #65 | merged — JSON viewer (S-04 review fixed) |
