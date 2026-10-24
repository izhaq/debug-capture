# S-09 — Accessibility

HLD rows: §9.1 S-09. Depends on S-05 … S-08 (the views and the frame are in place).
Source of truth: [`../../design/HLD.md`](../../design/HLD.md). When this spec and
the HLD disagree, the HLD wins.

## Goal

Prove the panel can be used with the keyboard only, and that it stays usable
in forced colours and with reduced motion (`FR-COM-05`, `NFR-A11Y-01`).
Contrast of the colour tokens stays the S-04 script (`npm run contrast`).

Most of the map and the look already shipped with the building blocks and the
frame (focus ring, reduced-motion blanket, forced-colour tokens, list and
tree keys, `Alt+1` / `Alt+2`, `Ctrl+F`, Escape order). This spec does not
rebuild those. It adds the gaps the walk found, plus one Playwright walk of the
whole panel:

- The banner's 2 px bar is only a shadow, so forced colours drop it. In that
  mode it becomes a 2 px border.
- Each view's "no match" block started visible, so the first paint showed it
  together with "nothing yet". It stays hidden until the first update.

## Requirements

| ID | Requirement | HLD |
|---|---|---|
| S09-01 | On the hostile host, with no mouse: `Ctrl+Alt+Shift+P` opens the panel and moves focus in. `Tab` reaches the resize handle, the section tabs, the Network sub-tabs, the request list, an open detail and the JSON tree. `←` `→` move both tab bars. `Alt+1` / `Alt+2` show Network / Console. `↑` `↓` `Home` `End` `PageUp` `PageDown` move the list selection. `Enter` on the list opens the detail. `←` `→` `Enter` `Space` collapse and expand the JSON tree. `Ctrl+F` focuses the filter box only when focus is already inside the panel. `Escape` closes the detail first, then the panel, and focus returns to the control that opened it. Keys pressed inside the panel do not reach the host, except the global toggle chord. | FR-COM-05, ISO-07, ISO-16, §4.12 |
| S09-02 | Forced colours: the panel's text colour follows the system colours, a 4xx row still shows its status word and an icon, and the capture-off banner keeps a 2 px bar at the start (a border, not the shadow). | NFR-A11Y-01, §5.6, §5.7 |
| S09-03 | Reduced motion: with `prefers-reduced-motion: reduce`, the panel computes no transition and no animation. There is no motion by default either. | NFR-A11Y-01, §5.7 |
| S09-04 | Keyboard focus draws the 2 px accent outline (`:focus-visible` only). In forced colours that outline is the system highlight. | NFR-A11Y-01, §5.7 |
| S09-05 | Each view's "no match" block is hidden until the first update, so the first paint shows only the empty message. | NFR-A11Y-01, §4.11 |

## Out of scope

Wiring the panel into the playground (after S-10). Angular, React and plain
host pages, performance numbers, security review, `npm pack` and the README
(S-10). The v1 chords `Ctrl+Alt+Shift+D` / `C` / `X` (S-01; unchanged). A
separate window, Hebrew UI, the Problems tab, column picker, export of the
current view only. Raising the loader or UI size budgets.

## Acceptance

- `test/e2e/panel-a11y.spec.mjs` walks S09-01 and checks S09-02, S09-03 and S09-04 on the real panel.
- `frame.spec.ts` locks the banner rule in `FRAME_CSS` (S09-02).
- `npm run contrast` still passes (S-04 owns the script; this slice re-runs it).
- `test/unit/spec-floor.json` and `test/e2e-floor.json` rise to the new counts.

## Traceability

| MUST | Proved by |
|---|---|
| FR-COM-05 | `test/e2e/panel-a11y.spec.mjs` — keyboard walk |
| NFR-A11Y-01 (keyboard, focus, forced colours, reduced motion) | `test/e2e/panel-a11y.spec.mjs`; `src/panel/app/frame.spec.ts` (banner border) |
| NFR-A11Y-01 (first paint, §4.11) | `test/e2e/panel-ws.spec.mjs` sees only "No WebSocket connections yet." before any socket; the same initial hide is in the HTTP and Console views |
| NFR-A11Y-01 (contrast) | `npm run contrast` (S-04 script) |
| ISO-07, ISO-16 (as they apply to this walk) | the same e2e: host listeners stay quiet; focus returns to `#host-input` |
