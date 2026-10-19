# S-02 Panel loader — spec

**Source of truth:** HLD §4.1–§4.3, §5.3 (launcher), §6.1–§6.4, §6.6, §6.7
(`ISO-01` … `ISO-22`), `FR-ACT-01` … `07`, `FR-WIN-01`, `FR-WIN-05`,
`NFR-PERF-01`, `NFR-PERF-05`, `NFR-SIZE-01`, `NFR-REL-01`, `NFR-COMP-01`,
`D-06`, `D-07`, `D-10`, `D-11`, `D-16`. Evidence behind the rules:
`docs/research/host-impact-edge-cases.md` (§1 rules, §3 findings, §4 the
hostile host). Plan: [`../wave-2.md`](../wave-2.md).

## Goal

The part of the panel that lives in the host page from start-up: one isolated
host element, the launcher with its problems badge, the toggle shortcut, and
the lazy load of the UI chunk on first open — proven harmless against a
hostile host page. The real panel UI (frame, views) comes in wave 3; this spec
ships a **placeholder** UI (an empty panel root with a close button) so the
whole lazy path is real and testable.

## Requirements

| ID | Requirement | HLD |
|---|---|---|
| S02-01 | `installDebugPanel(controller, options?)` — the P5 value matching the S-00 type `InstallDebugPanel`. `null` controller → an inert handle (all methods no-ops, `isOpen` false), nothing mounted, no listener. | FR-ACT-01 |
| S02-02 | One host element `<debug-capture-panel-v2>` (`PANEL_ELEMENT_NAME`), mounted once on `<html>` after `<body>`, with an open shadow root holding the launcher and, from first open, the UI. Full viewport, `pointer-events: none !important`; only the launcher and the panel root take pointer events. Top layer via `popover="manual"` (Chrome 146+, `NFR-COMP-01`); no fallback. Never inside a framework root. | ISO-01, ISO-13 |
| S02-03 | Host lockdown: `:host { all: initial !important; … }`, every `:host` declaration `!important`, `contain: strict`; all inherited values set on the inner root; px only; system fonts; `direction: ltr`; hidden when printing; styles only through `adoptedStyleSheets` (no `<style>`, no `style` attribute strings). | ISO-02 … 06 |
| S02-04 | Event wall on the host element: pointer, mouse, key, focus, input, clipboard and drag events from inside the panel stop at the host element; the global `Ctrl+Alt+Shift+…` chords still reach the document. Never blocks the host's own capture-phase listeners. | ISO-07, D-16 |
| S02-05 | Toggle shortcut (`options.shortcut`, default `ctrl+alt+shift+p`) on `KeyboardEvent.code`; `preventDefault` only on an exact match; `false` disables it. | FR-ACT-05, ISO-08 |
| S02-06 | zone.js safety: `customElements.define` and every listener, timer, rAF and observer the loader creates run in `Zone.root` (when zone.js is present). | ISO-09, NFR-PERF-05 |
| S02-07 | Closed cost: one `keydown` listener, the launcher, and the badge counter (O(1) per entry, at most one rAF per frame when the number changes). No timers, observers or `matchMedia` listeners. The UI chunk is not loaded. | NFR-PERF-01, ISO-11, D-07 |
| S02-08 | Launcher (§4.2): 28 px pill, bottom-right, 12 px from the edges; `DBG` plus the problems count when > 0 (error colour); counts entries for which `isProblemEntry` is true since the panel was last closed; resets on open and on `cleared` (`recorder.onChange`); hidden while open; `launcher: false` hides it. Own tiny stylesheet using the HLD tokens it needs, light and dark by `prefers-color-scheme`. | FR-ACT-03, FR-ACT-04, D-06 |
| S02-09 | First open loads the UI chunk with **one** dynamic `import('./app')` and calls `mountPanelUi(shadowRoot, controller, { document, storageKey, defaultDock, onRequestClose })`; later opens reuse the loaded chunk. Close calls `unmount()`. A failed chunk load leaves the launcher working and is reported only through the handle (no `console`). | FR-ACT-02, D-10 |
| S02-10 | Focus: opening from the launcher or the shortcut moves focus into the panel; closing returns it to where it was; never steals focus otherwise; no focus trap; closed → the inner panel root is `hidden` + `inert`. | FR-ACT-07, ISO-16 |
| S02-11 | The panel never opens by itself; `handle.open()` exists for a host's own user action. `handle.dispose()` (also while open) closes, returns focus, unsubscribes and removes the listener, the launcher and the host element. | FR-ACT-06, §4.1 |
| S02-12 | Safe registration: `customElements.get` first; if the name is ours, reuse; if someone else's, do nothing and stay silent. Survive removal: if the host removes the element, clean up on disconnect and remount on the next open or launcher need; no `MutationObserver` fights. Static host element: no attribute changes after mount. | ISO-14, ISO-15, ISO-20, D-11 |
| S02-13 | A11y of the shell: the panel root has `role="dialog"`, `aria-modal="false"`, `aria-label`, `lang="en"`, `dir="ltr"`; the launcher is a real `<button>` with an accessible name that includes the count. | ISO-17 |
| S02-14 | Never feeds the recorder: no `console.*`, every callback in `try/catch`, every promise handled, re-entrancy guard. | ISO-12, NFR-REL-01 |
| S02-15 | Placeholder P4 `mountPanelUi`: renders a panel root (title "Debug", a close button that calls `onRequestClose`, `Escape` → `onRequestClose`) using plain DOM APIs and `textContent` only. It lands in its own chunk; S-08 replaces it. | §6.2 |
| S02-16 | Hostile-host fixture `test/hostile-host/` per research §4 and HLD §8.2, and Playwright tests proving every rule above on it (list in the brief). | ISO-22, NFR-ISO-01 |
| S02-17 | Sizes: loader ≤ 4 kB min+gzip; the placeholder UI is reported as the `panel-ui` chunk. | NFR-SIZE-01 |

## Out of scope

The frame, views, settings storage, banners, resize, dock, maximize (S-08 and
the views in wave 3). Host-modal detection (S-08 banner).

## Acceptance

Merged into the wave branch; `npm run check` exits 0 (including the new
Playwright tests); a fresh-context isolation review found no open blocker.
