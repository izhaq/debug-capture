# S-04 UI building blocks — spec

**Source of truth:** HLD §5 (all), §4.5–§4.8, §4.12, §6.2 (P2), §6.7
(`ISO-03`, `04`, `05`, `10`, `12`, `17`, `18`, `19`), `FR-COM-01`, `FR-COM-02`,
`FR-COM-04`, `FR-COM-05`, `NFR-PERF-04`, `NFR-SEC-01`, `NFR-A11Y-01`,
`NFR-I18N-01`, `D-04`, `D-13`. Mockup (illustration only):
`docs/design/mockup.html`. Plan: [`../wave-2.md`](../wave-2.md).

## Goal

The safe, themed, framework-free DOM pieces every view is built from: the
element builder, the theme stylesheet, icons, small controls, the virtual
list and the JSON viewer. Nothing here knows about HTTP, sockets or console —
views (wave 3) compose these.

## Requirements

| ID | Requirement | HLD | Track |
|---|---|---|---|
| S04-01 | Safe element builder: creates elements and SVG through DOM APIs only; strings always become text nodes; refuses `on*` attributes, `href`, `src`, `srcdoc`, `style` strings, `javascript:` anything; events only by listener. The `document` is passed in. | NFR-SEC-01, ISO-04 | 04a |
| S04-02 | Theme: `TOKENS` (dark, light) equal to HLD §5.4 — checked by `scripts/theme-check.mjs` (part of `npm run contrast`), which also checks `src/panel/launcher-tokens.ts` when present. `createThemeSheet(doc, extraCss?)` → one `CSSStyleSheet` (constructable): tokens on `.dcp-root`, theme by `data-theme` (`dark`, `light`) and Auto by `prefers-color-scheme` (no JS), text sizes 11/12/14 px (meta 10/11/13) by `data-text-size`, focus rules (§5.7), forced-colours mapping, `prefers-reduced-motion`, badge look (opaque 12 % background), row tints, `dcp-match`. px only; no `@font-face`, `@property`, `@import`. | §5.4, §5.5, §5.7, ISO-03, ISO-05 | 04a |
| S04-03 | Icons: inline SVG builders, 14 px, `currentColor`, for every icon §5 and §4 name (status ✓ ↪ ⚠ ✕ ◌, levels ℹ • ⋯, WS ↑ ↓ ● ■, badges 🔒 ✂ ◌, toolbar ⏸ ▶ ⟲ ⇩ ⚙ ⤢ ✕, search, chevrons, ↓ new). Decorative icons are `aria-hidden`. | §5.1, §5.6 | 04a |
| S04-04 | Controls with keyboard and ARIA: button (and icon button with a label), tabs (`tablist`, ← → move, `aria-selected`), chip group (toggle, "All" resets, `aria-pressed`), search box (150 ms debounce via an **injected** scheduler), split pane (draggable, min 240 px, pointer capture on our element, keyboard-resizable), menu/popover (Escape closes, returns focus), empty / no-match block with an optional button, badge. Each exposes `destroy()` that removes every listener. | §4.5, §4.11, §4.12, §5.7, ISO-19 | 04a |
| S04-05 | Virtual list: fixed row height (20 / 22 / 26 px by text size), renders only the visible rows plus overscan, < 2,000 nodes whatever the item count; columns; selection with ↑ ↓ Home End PgUp PgDn Enter; follow-bottom API (`isAtEnd`, `scrollToEnd`) for the "↓ N new" button; bidi-safe cells (`dir="auto"`, `unicode-bidi: plaintext`); `role="grid"` (or `listbox`) with `aria-rowcount` / `aria-rowindex`; no layout writes inside `ResizeObserver`; update with a new item array in O(visible rows). | NFR-PERF-04, ISO-10, ISO-12, ISO-18, FR-COM-05 | 04b |
| S04-06 | JSON viewer: collapsible tree (`role="tree"`, ← → Enter Space), objects/arrays show the first 100 children then "Show 100 more", strings over a limit show "Show all (N chars)", children render only when expanded; strings, numbers, booleans, null, `redactedValue` (badge), `…[truncated N chars]` (badge), and every v1 placeholder (`FR-COM-01` list) are visually distinct; Raw view is the caller's job. Text only — never interprets values as HTML. | FR-COM-01, FR-COM-02, D-04 | 04c |
| S04-07 | Performance: building the list for 5,000 items and scrolling end to end stays under 2,000 nodes and within a measured budget; expanding a 2,000-key object renders ≤ 100 children. Timing specs with honest margins. | NFR-PERF-04 | 04b, 04c |

## Out of scope

Views, the frame, storage, the scheduler (wave 3). Any HTTP/WS/console logic
(S-03).

## Acceptance

All three tracks merged; `npm run check` exits 0 (including `contrast` with
the theme check); a fresh-context review (DOM safety, performance, a11y)
found no open blocker.
