# Debug panel: how it can still affect the host app

**Status:** Research, 2026-10-14. Input for `specs/5-debug-panel/spec.md`.
**Question:** The panel will be a framework-free Web Component (Custom Element +
Shadow DOM), fed by `recorder.onEntry()`. It ships in production behind the
debug flag. Even with Shadow DOM, how can it change the page it lives in?
**Short answer:** Shadow DOM fences off **selectors**. It does not fence off
inheritance, rules that target the element itself, events, focus, the
accessibility tree, the main thread, zone.js, CSP, or where the element sits
in the page. Each of those needs a rule in the spec.

Words used below:

- **host app / host** — the page the panel lives in (Angular, React, plain).
- **host element** — our `<dc-debug-panel>` tag itself, in the host's DOM.
- **shadow tree** — the panel's private DOM inside the host element.
- **retargeting** — outside the shadow tree, an event's `target` (and
  `document.activeElement`) shows our host element, not the inner node.
- **top layer** — a browser layer above all `z-index` values. `popover` and
  `<dialog>` use it.
- **CD** — Angular change detection: one pass over the app's components.

---

## 1. Summary

### Top 10 risks

| # | Risk | Severity | Rules |
|---|------|----------|-------|
| 1 | **Host CSS beats `:host`.** `* {}`, `body > *`, tag and `[class]` rules hit our host element and win over normal `:host` rules (display, position, margin, transition, animation). Inherited values (`font`, `color`, `line-height`, `pointer-events`, `visibility`, `cursor`, `white-space`, `rem`…) flow straight into the shadow tree. | High | 2, 3, 5 |
| 2 | **Events leak out, retargeted.** Clicks in the panel close the host's "click outside" menus. Typing in the panel's filter box fires host hotkeys, because the host's "is the user typing in an `<input>`?" check sees our custom tag, not the input. `Escape` in the panel closes the host's top dialog / `mat-select`. | High | 7, 8 |
| 3 | **zone.js turns panel work into Angular CD.** Every listener, timer, `requestAnimationFrame` and `MutationObserver` / `IntersectionObserver` callback made inside Angular's zone runs CD. 3 listeners × 20 mouse moves = 60 CD passes. zone.js also runs custom-element callbacks in the zone that was active at `customElements.define` time. | High | 9 |
| 4 | **Rendering thousands of rows blocks the app.** 5,000 rows = 65,000 DOM nodes and a 450 ms long task. Rendering each entry as it arrives, with auto-scroll, costs 4× more than batching once per frame. | High | 10, 11 |
| 5 | **`position: fixed` and `z-index` break.** A `transform`, `filter`, `contain: paint`, `will-change: transform`, `backdrop-filter` or `perspective` on `<body>` turns "fixed" into "scrolls with the page". When `z-index` values tie, the host's later overlay wins. `opacity` / `filter` on `<body>` dim or recolour the panel. | High | 1 |
| 6 | **CSP and Trusted Types block normal techniques.** With `style-src 'self'`, `<style>` tags and `style=""` attributes are blocked (they also send violation reports to the host). With Trusted Types, `innerHTML` throws. | High (for portability) | 4 |
| 7 | **Captured data is untrusted.** Response bodies, log strings and URLs can hold HTML or `javascript:` links. Rendering them with `innerHTML` or as links is an injection hole in a production page. | High | 4 |
| 8 | **Host modals, `inert`, `aria-hidden` and fullscreen can make the panel unusable.** A host `<dialog>.showModal()` makes the panel unclickable and unfocusable, even if we show it again in the top layer. A fullscreen element hides it. Libraries that set `inert` / `aria-hidden` on `<body>` children disable it or hide it from screen readers. | Medium (can't fully fix; must document) | 1, 21 |
| 9 | **Mounting and lifecycle surprises.** Adding a child to `<body>` changes host `:last-child` / `:only-child` / `body > *` matches. `createRoot(document.body)` deletes our element. A second `customElements.define` with the same name throws. An `id` on our element becomes a `window` property. | Medium | 1, 14, 15 |
| 10 | **Feedback loops and error noise.** If the panel logs, throws, rejects a promise or causes a `ResizeObserver` loop, our own recorder captures it, which feeds the panel again. The error also reaches the host's error reporting. | Medium | 12 |

### Rules for the panel (copy into the spec)

1. **Mount on `<html>`, not `<body>`.** Append the host element to
   `document.documentElement` (after `<body>`), once, lazily on first open.
   Show it in the **top layer** with `popover="manual"` + `showPopover()`.
   If that is missing, fall back to `position: fixed` with
   `z-index: 2147483647`. Never mount inside a framework root.
2. **Lock down the host element.** One rule:
   `:host { all: initial !important; … }`. Every `:host` declaration gets
   `!important` (inside-the-shadow `!important` beats every outer rule,
   even outer `!important` and inline `style`). Include `display`,
   `position`, `inset`, `width`/`height`, `z-index`, `contain: strict`,
   `pointer-events: auto`, `visibility: visible`, `transition: none`,
   `animation: none`, `outline: none`.
3. **Set every inherited value ourselves.** On an inner root element:
   font family/size/weight/style, `line-height`, `color`, `background`,
   `letter-spacing`, `white-space`, `text-align`, `text-transform`,
   `cursor`, `color-scheme`, `direction: ltr` (`all` does **not** reset
   `direction`). Use **px**, never `rem`. Use a system font stack only.
4. **CSP- and Trusted-Types-safe DOM.** Styles only via
   `adoptedStyleSheets` (constructable `CSSStyleSheet`). Dynamic styles only
   via `el.style.prop = …`. No `<style>` elements, no `style=""` attributes,
   no `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `setHTMLUnsafe`, no
   inline `on*` handlers, no `eval`, no Trusted Types policy. Captured data
   goes in **only** via `textContent` / `createTextNode`. Never build an
   `href` / `src` from captured data.
5. **Nothing global in CSS.** Prefix custom properties `--dcp-` and set
   them on our inner root (never rely on `var(--x, fallback)`). No
   `@property`, no `CSS.registerProperty`, no `@font-face`, no
   `document.fonts.add`, no `part` / `exportparts`, nothing added to
   `document.adoptedStyleSheets`.
6. **Hide when printing:** `@media print { :host { display: none !important } }`.
7. **Event wall on the host element.** In the panel constructor, call
   `this.addEventListener(type, e => e.stopPropagation())` (bubble phase,
   **on the host element, not the shadow root**). Types: pointer*, mouse*,
   `click`, `dblclick`, `auxclick`, `contextmenu`, `wheel`, touch*, key*,
   `beforeinput`, `input`, `focusin`, `focusout`, composition*, `copy`,
   `cut`, `paste`, `dragstart`. Let our own debug-capture chords through,
   or handle them in the panel. Do **not** try to block the host's
   capture-phase listeners: the only way (a `window` capture guard) also
   silences the panel's own listeners.
8. **Keys.** The panel's toggle shortcut uses three modifiers and
   `event.code`, like the existing ones. `preventDefault()` only on an exact
   match. Inside the panel, `Escape` is handled and stopped by the panel.
9. **zone.js.** Call `customElements.define`, and register **every**
   listener, timer, rAF and observer, inside `Zone.root.run` (looked up
   from the global, never imported, like `outsideZones()`). The `onEntry`
   listener only pushes to a queue. The flush is one rAF, scheduled from
   the root zone.
10. **Virtualise and batch.** Render only the visible rows plus a small
    margin (target: under 2,000 nodes per tab). Apply new entries at most
    once per frame, with a time budget (around 8 ms) per frame. Bodies and
    stacks start collapsed and are capped on screen.
11. **Zero cost when closed.** When closed: no rows in the DOM, no
    `onEntry` subscription, no timers, no rAF, no observers. One `keydown`
    listener (root zone) for the toggle is the only thing left. On open,
    read `recorder.snapshot()`, then subscribe.
12. **Never feed the recorder.** No `console.*` calls in panel code. Every
    callback is wrapped in `try/catch`; every promise has a `.catch`. No
    layout writes inside `ResizeObserver` callbacks. Add a re-entrancy guard
    on render.
13. **Overlay, never dock.** Do not change host layout: no body padding,
    margin or `overflow`, no scroll lock. Every scroller (and the panel
    root) gets `overscroll-behavior: contain`.
14. **Safe registration.** `customElements.get(name)` before `define`. Use a
    prefixed, versioned name. If it is already taken, reuse it or quietly do
    nothing. Never throw. One panel per page.
15. **Static host element.** No `id`, `class` or attribute changes on the
    host element after mounting. Keep all state inside the shadow root. No
    `window` globals.
16. **Focus.** Never move focus when the panel opens by itself (startup,
    restored state). Move focus in only when the user opened it with a key
    or click. On close, give focus back to the element that had it. No
    focus trap. When closed, the panel is `hidden` + `inert`.
17. **Accessibility.** Inner root: `role="dialog"` with
    `aria-modal="false"` (or `role="complementary"`),
    `aria-label="Debug panel"`, `lang="en"`, `dir="ltr"`. No `aria-live` on
    rows. Respect `prefers-reduced-motion`. Work in forced-colors mode: use
    system colours and never show status by colour alone.
18. **Bidi-safe cells.** Data cells get `dir="auto"` and
    `unicode-bidi: plaintext`, so Hebrew/Arabic text and bidi control
    characters cannot reorder the cells around them.
19. **Drag and resize** with `setPointerCapture` on our own element. No
    `mousemove` / `pointermove` listeners on `document` or `window`.
20. **Survive removal.** If `disconnectedCallback` fires (host cleared the
    page), clean up and mount again on the next open. No MutationObserver
    "fight" to stay in the page.
21. **Document the limits** in the panel README: a host modal `<dialog>`,
    `inert`, `aria-hidden` and fullscreen can block or hide the panel. The
    host's capture-phase listeners still see the panel's events (target =
    our host element). A separate window is the escape hatch.
22. **Ship a "hostile host" test fixture** (section 4) and run every test
    below against it.

---

## 2. How this was checked

- **VERIFIED** = reproduced in Chromium 141.0.7390.37 (Playwright 1.56.1,
  headless) with a minimal page. Angular checks used the repo's real
  `zone.js` 0.13.3 and `NgZone` from `@angular/core` 16.2.12, bundled with
  esbuild. Change detection was counted as `NgZone.onMicrotaskEmpty`
  emissions (that is what triggers `ApplicationRef.tick()` in a real app).
  React checks used React / React DOM 19.3.0.
- **REASONED** = not run; based on the cited spec, MDN page, or library
  source in this repo's `node_modules`.
- Throwaway experiment scripts lived in the session scratchpad and are not
  committed. Each item names its experiment (X1–X10) and gives the key
  setup, so it can be rebuilt as a real test.
- Experiments:

  | ID | What it set up |
  |---|---|
  | X1 (A–L), X1b | Host CSS vs a minimal `<x-panel>`: inherited properties, `all: initial`, outer rules on the host element, `!important` contexts, `:focus`, `@keyframes`, `@property`, sibling selectors |
  | X2 | `@font-face` in the shadow root vs the host's, print media, forced colours |
  | X3 | `position: fixed` under each containing-block property on `<body>`, three mount points |
  | X4, X4b | `z-index` ties, top layer vs host modal `<dialog>` and `popover="auto"`, ancestor opacity/filter (screenshot diff), fullscreen |
  | X5, X5b | Real mouse/keyboard input into the panel; what reaches `document`; host "click outside", hotkey and `Escape` handlers; three guard placements |
  | X6 | Scroll chaining, host wheel blocker, `inert` / `aria-hidden` on body children, host `MutationObserver`, double `define`, `id` → `window`, `ResizeObserver` loop, Playwright locators |
  | X7, X7b, X7c | Real `NgZone` + zone.js: listeners in the shadow tree, define-time zone, `onEntry` scheduling, observers, timers |
  | X8 | Render cost: 5,000 rows vs virtual window, `content-visibility`, streaming, `contain`, 32 KB cell; CDP `Nodes` metric |
  | X9 | React 19.3: `createRoot(document.body)`, `hydrateRoot` with the panel inside/outside the container, root event delegation |
  | X10 | CSP `style-src 'self'` and Trusted Types headers vs each styling and DOM technique; violation events |

- Other browsers were not tested. The stations run Chromium-based browsers.
  Firefox / Safari differences are flagged where known.

**Totals:** 82 items. 59 VERIFIED (the main claim was reproduced; a few
carry a reasoned side note, marked as such), 23 REASONED.

Severity is **for us**: Angular 16 + Material/CDK host (28 `MatSelect`s,
tooltips, CDK overlays), production builds, air-gapped stations. Future
React / plain-HTML hosts are noted where they differ.

---

## 3. Findings

### 3.1 Styles coming in

**S1. Inherited properties cross the shadow boundary.**
- *What happens:* Every inherited CSS property set on `html` / `body` flows
  into the shadow tree.
- *Real?* VERIFIED (X1-A). With host `body {…}` and only
  `:host { display: block }`, an inner `<span>` got: `font-family: serif`,
  `color: red`, `line-height: 30px`, `cursor: wait`, `visibility: hidden`,
  `pointer-events: none`, `user-select: none`, `letter-spacing`,
  `text-transform: uppercase`, `white-space: nowrap`, `text-align: right`,
  `word-spacing`, `font-style`, `font-weight: 900`,
  `font-variant-numeric`, `text-shadow`, `-webkit-text-fill-color`,
  `caret-color`, `accent-color`, `color-scheme: dark`, `scrollbar-color`,
  `border-collapse`, `list-style-type`, `text-indent`, `tab-size`,
  `hyphens`, `word-break`, `overflow-wrap`, `-webkit-font-smoothing`.
- *Severity:* High. `pointer-events: none` or `visibility: hidden` on body
  (some modal libraries set these) makes the panel dead or invisible.
  `white-space: nowrap` or `text-transform` garbles log text.
- *Mitigation:* Rules 2 and 3. `:host { all: initial !important }`, then set
  every value we care about on our inner root.
- *Test:* Hostile fixture sets all the properties above on `html`/`body`.
  Assert the computed style of a row cell equals the panel's own values.

**S2. `all: initial` does not reset `direction` or custom properties.**
- *What happens:* `all` skips `direction`, `unicode-bidi` and custom
  properties (CSS Cascade 5, `all` shorthand).
- *Real?* VERIFIED (X1-B, X1-C). With `<html dir="rtl">` and
  `:host { all: initial !important }`, the inner node still had
  `direction: rtl`, `--brand: hotpink`.
- *Severity:* Medium (RTL hosts; Hebrew pages).
- *Mitigation:* Rule 3 (`dir="ltr"` / `direction: ltr` on the inner root)
  and rule 5.
- *Test:* Fixture with `<html dir="rtl">`. Assert inner root
  `direction === 'ltr'` and the first column is on the left.

**S3. Custom properties flow in.**
- *What happens:* `:root { --bg: … }` in the host reaches any
  `var(--bg)` we use. A fallback `var(--bg, #222)` is skipped, because the
  inherited value exists.
- *Real?* VERIFIED (X1-A: `--brand`, `--dcp-bg` from body visible inside).
- *Severity:* Medium. Common names (`--bg`, `--primary`, `--font`) clash.
- *Mitigation:* Rule 5. Prefix `--dcp-`, and **define** every one on the
  inner root (a declared value beats an inherited one).
- *Test:* Fixture defines `--dcp-*` and common names on `:root` with loud
  colours. Assert panel colours do not change.

**S4. A host `@property` registration breaks our variable of the same name.**
- *What happens:* `@property` is global. If the host registers `--accent`
  as `<color>` with `inherits: false`, our `--accent: 10px` is invalid. It
  becomes the host's initial value, and our `var(--accent, green)` fallback
  is ignored too.
- *Real?* VERIFIED (X1-J: inner colour became `rgb(0,0,0)`, not green).
- *Severity:* Low with the `--dcp-` prefix. **Out of scope by owner decision (HLD D-23).**
- *Mitigation:* Rule 5.
- *Test:* Fixture registers `@property --dcp-bg { syntax: '<length>' … }`.
  Assert the panel background is still correct. This proves the inner root
  sets plain colours, not only vars. Or: assert the panel's stylesheet text
  has no `var(` without a `--dcp-` prefix (lint).

**S5. `rem` uses the host's root font size.**
- *Real?* VERIFIED (X1-A: `10rem` = `100px` when `html { font-size: 10px }`).
- *Severity:* Medium. Many hosts use `62.5%` or fluid root sizes, so the
  panel would shrink or grow.
- *Mitigation:* Rule 3: px only.
- *Test:* Lint: no `rem` / `em` / `vw` font sizes in panel CSS. Fixture
  with `html { font-size: 10px }` → row height unchanged.

**S6. Outer rules aimed at our host element beat normal `:host` rules.**
- *What happens:* `:host` rules are in the "inner" context. For normal
  declarations, **outer wins** no matter the specificity (CSS Cascade 5,
  §6.1 "Context"). So `* { margin: 5px; transition: all 1s; animation: … }`,
  `body > * { position: relative; z-index: 1; display: flex }`,
  `dc-debug-panel { display: none }` all apply to our host element.
- *Real?* VERIFIED (X1-D). Our `:host { display: block; position: fixed;
  z-index: 2147483647; margin: 0 }` lost: computed `display: none`,
  `position: relative`, `z-index: 1`, `margin: 5px`, `transition: all 1s`,
  `animation: spin`.
- *Severity:* High. Global resets and "every direct child of body" rules
  are common.
- *Mitigation:* Rule 2. For `!important`, **inner wins**. VERIFIED (X1-E,
  X1-F, X1-G): `:host { … !important }` beat outer normal rules, outer
  `!important` rules, **and** an inline `style="display:none !important"`
  on our element.
- *Side effect:* The host **cannot** hide the panel with CSS. If a host
  ever needs that, give it a JS API (`panel.close()`), not a CSS hook.
- *Test:* Fixture CSS: `* { margin: 5px; transition: all 1s; animation:
  spin 1s infinite }`, `body > *, html > * { position: relative; z-index: 1;
  display: flex }`, `[class] { opacity: .5 }`, `dc-debug-panel {
  display: none !important }`. Assert the host element's computed
  `position: fixed`, `display: block`, margin 0, no running animations
  (`getAnimations().length === 0`).

**S7. Host `*` rules do not reach inside the shadow tree.**
- *Real?* VERIFIED (X1-D: inner `margin: 0`, `animation: none`,
  `transition: 0s` under host `* {…}`). Only the host element itself is hit
  (S6). Good news. Inherited values still flow (S1).
- *Severity:* Info.

**S8. Outer `:focus`, `:focus-within`, `:hover` match our host element.**
- *What happens:* When an inner input has focus, our host element matches
  `:focus` and `:focus-within`, and so does `<body>`. Host rules like
  `*:focus { outline: 2px solid }` draw a ring around the **whole panel**.
  `document.activeElement` is our host element.
- *Real?* VERIFIED (X1-H: host `matches(':focus') === true`, computed
  outline `solid 5px`, background from `:focus-within`).
- *Severity:* Low (cosmetic). It is fixed by rule 2 (`outline: none`
  and `background` in the `all: initial !important` set).
- *Test:* Focus the filter input. Assert the host element's computed
  `outline-style === 'none'`.

**S9. `@font-face` inside a shadow root is ignored; the host's is used.**
- *What happens:* Chromium ignores `@font-face` rules in shadow-tree
  stylesheets (the font file is never requested). If our CSS names a family
  the host defined (e.g. `Inter`), we silently get the host's font.
- *Real?* VERIFIED (X2: only `/host-font.ttf` was requested;
  `document.fonts` listed only the host face).
- *Severity:* Low (air-gapped: we can't load web fonts anyway).
- *Mitigation:* Rule 3: system font stacks only
  (`ui-monospace, Menlo, Consolas, "Liberation Mono", monospace`).
- *Test:* Assert the panel causes no network requests (fixture counts
  requests before/after open).

**S10. Forced colours (Windows high contrast) override our colours.**
- *Real?* VERIFIED (X2 with `forcedColors: 'active'`: our blue
  background → white, red text → black, a green button → white).
- *Severity:* Low. Expected and correct, but status shown by colour alone
  (red = failed request) disappears.
- *Mitigation:* Rule 17: status as text / icon too. Use
  `forced-color-adjust: none` only on small swatches, if ever.
- *Test:* Run the visual test with `forcedColors: 'active'`. Assert failed
  rows still carry a text marker.

**S11. `color-scheme` is inherited.**
- *What happens:* Host `color-scheme: dark` makes our scrollbars, inputs and
  checkboxes dark (or light), whatever we paint behind them.
- *Real?* VERIFIED (X1-A: inner `color-scheme: dark`).
- *Severity:* Low. Fixed by rule 3 (set our own `color-scheme`).

**S12. `@keyframes` names do not clash across the boundary.**
- *Real?* VERIFIED (X1b). The shadow tree could not use the host's
  `@keyframes`, and the host could not use ours; our own keyframes worked.
- *Severity:* Info. Safe to use `@keyframes` inside the shadow stylesheet.

**S13. Ancestor `opacity`, `filter` and `zoom` apply to us visually.**
- *What happens:* These are not inherited values. They are applied to the
  whole painted subtree, so CSS inside the panel cannot undo them.
- *Real?* VERIFIED (X4, screenshot comparison).
  `body { opacity: .5 }` and `body { filter: invert(1) }` changed a
  `<body>`-mounted panel, but not an `<html>`-mounted one and not a top-layer
  one. `html { filter: invert(1) }` changed both normal mounts, **but not
  the top-layer one**.
- *Severity:* Medium (dimmed "loading" states on body; dark-mode filter
  hacks on html).
- *Mitigation:* Rule 1 (`<html>` mount + top layer).
- *Test:* Fixture with `body { opacity: .3 }` and `html { filter:
  invert(1) }`. Screenshot the panel and compare with a plain host.

**S14. Text decorations propagate to in-flow descendants.**
- *What happens:* `body { text-decoration: underline }` is drawn across the
  text of in-flow descendants, but not across out-of-flow (fixed / absolute)
  ones (CSS Text Decoration 3, §2.1). Computed `text-decoration-line`
  stays `none`, so it can't be seen in computed styles.
- *Real?* REASONED (spec). The computed-style check in X1-A showed `none`,
  as expected.
- *Severity:* Low. Our host element is always fixed or top layer (rule 1),
  so it is out of flow.

### 3.2 Styles going out

**O1. Our stylesheets do not leak out.**
- *Real?* REASONED: selector scoping is the core Shadow DOM promise (DOM
  spec, "shadow tree"; CSS Scoping). Partly VERIFIED: our `@keyframes` did
  not reach the host (X1b).
- *Severity:* Info. Holds for `<style>` and `adoptedStyleSheets` alike.
  The leak risk is only through the global APIs in O2–O4.

**O2. `@property` inside a shadow stylesheet is ignored; `CSS.registerProperty` is global.**
- *Real?* VERIFIED (X1-J: a shadow `@property --dcp-len` was not registered
  anywhere, not even inside the shadow tree. X1-K:
  `CSS.registerProperty({ name: '--x-gap' })` from panel code showed
  `--x-gap: 4px` on the host's `<body>`).
- *Severity:* Medium. A global registration can break the host the same way
  S4 breaks us.
- *Mitigation:* Rule 5. *Test:* Lint: no `@property` / `registerProperty`
  in panel sources.

**O3. `document.fonts.add()`, `document.adoptedStyleSheets` and `::part` are global.**
- *What happens:* `FontFace` objects added to `document.fonts` are visible
  to the host's CSS by family name. Anything pushed to
  `document.adoptedStyleSheets` styles the host. A `part="…"` attribute
  lets host CSS style our inner node with `::part()`, and invites the host
  to depend on our internals.
- *Real?* REASONED (CSS Font Loading §3; CSSOM `adoptedStyleSheets`; CSS
  Shadow Parts).
- *Severity:* Low. *Mitigation:* Rule 5. *Test:* Lint for `fonts.add`,
  `document.adoptedStyleSheets`, `part=`, `exportparts`.

### 3.3 Layout and stacking

**L1. `position: fixed` breaks under a transformed / filtered / contained `<body>`.**
- *What happens:* These properties on an ancestor make it the "containing
  block" for fixed descendants. "Fixed" then means "fixed to body", so the
  panel scrolls away and is offset.
- *Real?* VERIFIED (X3). Body with `margin-top: 100px`, page scrolled
  500 px, panel `top: 0`. The panel's `getBoundingClientRect().top` in each
  case:

  | body has | mounted in `<body>` | on `<html>` | top layer |
  |---|---|---|---|
  | nothing | 0 | 0 | 0 |
  | `transform: translateX(0)` | **-400** | 0 | 0 |
  | `filter: blur(0)` | **-400** | 0 | 0 |
  | `contain: paint` | **-400** | 0 | 0 |
  | `will-change: transform` | **-400** | 0 | 0 |
  | `backdrop-filter` | **-400** | 0 | 0 |
  | `perspective` | **-400** | 0 | 0 |
  | `container-type: inline-size` | 0 | 0 | 0 |

- *Severity:* High. Animation libraries and "smooth scroll" wrappers put
  transforms on body / app roots. An `<html>`-level transform would still
  break the `<html>` mount (REASONED, same rule). The top layer is immune.
- *Mitigation:* Rule 1.
- *Test:* Fixture runs each row of the table. Assert the panel rect stays
  pinned to the viewport after scrolling.

**L2. Adding a child to `<body>` changes host selectors.**
- *What happens:* `app-root:last-child`, `app-root:only-child`,
  `body > *`, `body > :last-child`, `body:has(> …)` start or stop matching
  when we append to `<body>`.
- *Real?* VERIFIED (X1b). `app-root:last-child { color }` and
  `app-root:only-child { outline }` **stopped** applying to the host's
  `<app-root>` once we appended to body. They applied again when we moved to
  `<html>`. `body > * { margin-left: 7px }` hit our element in body, not on
  html.
- *Severity:* Medium. It changes the host's look just by opening the panel.
- *Mitigation:* Rule 1 (`<html>` mount).
- *Test:* Fixture CSS `body > :last-child { outline: 3px solid red }`.
  Assert app root computed styles are equal before and after the panel
  mounts.

**L3. `z-index` ties go to the later element.**
- *What happens:* Host overlays (CDK overlay container, React portals,
  toasts) are appended to `<body>` **after** us. With equal `z-index`
  (even the max, 2147483647) the later one paints on top.
- *Real?* VERIFIED (X4). A body-mounted panel lost to a later
  `z-index: 2147483647` overlay. An `<html>`-mounted panel (after body in
  DOM order) and a top-layer panel won.
- *Severity:* Medium. CDK uses `z-index: 1000`, so we win there anyway, but
  toast and "max z-index" libraries exist.
- *Mitigation:* Rule 1. *Test:* Fixture appends a full-screen
  `z-index: 2147483647` div after the panel opens. Assert
  `elementFromPoint` over the panel is our host element.

**L4. A host modal `<dialog>` makes the panel unusable.**
- *What happens:* `dialog.showModal()` makes everything outside that dialog
  "blocked by a modal dialog", i.e. inert (HTML spec, "modal dialogs and
  inert subtrees"). That includes our top-layer popover.
- *Real?* VERIFIED (X4). After the host's `showModal()`:
  - clicks on the panel did nothing;
  - `focus()` on our button left focus in the dialog;
  - hiding and showing our popover again (so it is above the dialog in the
    top layer) **did not help**. Hit testing still went to the dialog.
- *Severity:* Medium. This repo's Material dialogs are **not** native
  `<dialog>`s (CDK overlays), so not affected today. Native modals are
  becoming common.
- *Mitigation:* Accept and document (rule 21). Do **not** make the panel
  itself a modal `<dialog>`: that would make the host inert. The capture
  keeps recording. Download (`Ctrl+Alt+Shift+D`) still works. A
  separate-window mode is the full fix.
- *Test:* Fixture opens a native modal. Assert the panel shows a
  "blocked by page dialog" hint, or at least does not throw, and capture
  still records.

**L5. Host `popover="auto"` closes our `popover="auto"`.**
- *What happens:* Opening any `auto` popover "light dismisses" the other
  open `auto` popovers that are not its ancestors.
- *Real?* VERIFIED (X4). Ours as `auto` was closed by the host's popover;
  ours as `manual` stayed open. The reverse also holds: a click inside our
  panel is a click "outside" the host's `auto` popovers, so they close.
  That is normal outside-click behaviour (see E2).
- *Mitigation:* Rule 1 (`popover="manual"`). *Test:* Fixture opens a host
  `popover="auto"`. Assert ours is still `:popover-open`.

**L6. Fullscreen hides the panel.**
- *What happens:* While a host element is fullscreen, only it (and its
  subtree) is shown.
- *Real?* VERIFIED (X4, X4b). Our fixed max-`z-index` panel was hidden
  behind the fullscreen element. A top-layer popover shown **after**
  entering fullscreen was hidden too, unless it was a descendant of the
  fullscreen element.
- *Severity:* Low (dashboards sometimes go fullscreen).
- *Mitigation:* Accept and document (rule 21). Do not move our element into
  the host's fullscreen element; that would change the host DOM. Optional:
  listen for `fullscreenchange` (root zone) and show a small note when
  closed.
- *Test:* Enter fullscreen on a fixture element. Assert nothing throws and
  the panel works again after exit.

**L7. Docking changes host layout.**
- *What happens:* A docked panel (pushing content up or aside) must change
  `body` / `html` padding or height. That changes the host's `100vh` maths
  and sticky headers. It also fires every host `ResizeObserver` (grids
  re-measure) and shifts layout.
- *Real?* REASONED.
- *Severity:* Medium if docking is built. *Mitigation:* Rule 13 (overlay
  only). *Test:* Assert `document.body.getBoundingClientRect()` and
  `html`/`body` inline styles are unchanged after open/close.

**L8. Scroll locking and `overflow`.**
- *What happens:* If the panel set `overflow: hidden` on body (a common
  "modal" pattern), the host page would stop scrolling and jump (scrollbar
  width). Host scroll locks (CDK `BlockScrollStrategy` sets
  `cdk-global-scrollblock` on `<html>`) don't affect a fixed / top-layer
  panel.
- *Real?* REASONED. *Mitigation:* Rule 13. *Test:* Same as L7.

**L9. Scroll chaining moves the host page.**
- *What happens:* When our list hits its end, extra wheel scroll goes to the
  page. A wheel over a non-scrolling part of the panel scrolls the page
  directly.
- *Real?* VERIFIED (X6). Wheeling over our list scrolled it to the end, then
  the page by 1,200 px. With `overscroll-behavior: contain`, the page
  stayed at 0. (X5: a wheel over the panel's non-scrolling area scrolled the
  page by 200 px.)
- *Severity:* Medium (annoying: the operator loses their place).
- *Mitigation:* Rule 13. Make the panel root itself the outer scroll
  container with `overscroll-behavior: contain`, so no wheel over the panel
  reaches the page.
- *Test:* Wheel past the end of a list, and over the panel header. Assert
  `window.scrollY` is unchanged.

**L10. A host non-passive wheel handler can freeze our scrolling.**
- *Real?* VERIFIED (X6). `window.addEventListener('wheel', e =>
  e.preventDefault(), { passive: false })` stopped our list from scrolling.
- *Severity:* Low (map / zoom widgets do this). *Mitigation:* Rule 7 stops
  `wheel` at our host element, which protects us from host **bubble**
  listeners. Capture-phase ones still win.
- *Test:* Fixture adds the listener above on `window` (bubble). Assert our
  list scrolls.

**L11. Printing.**
- *Real?* VERIFIED (X2). With `@media print { :host { display: none
  !important } }`, computed `display` was `none` under print emulation.
- *Mitigation:* Rule 6. *Test:* `page.emulateMedia({ media: 'print' })`.
  Assert the host element is hidden.

**L12. RTL hosts and bidi text.**
- *What happens:* `dir="rtl"` on `<html>` flips our layout (S2). Hebrew or
  Arabic text inside log lines and URLs can visually reorder the cells next
  to it. Bidi control characters (U+202E) in captured data can make text
  look different from what it is.
- *Real?* VERIFIED for `direction` inheritance (X1-B/C). REASONED for bidi
  reordering (Unicode Bidirectional Algorithm; CSS Writing Modes
  `unicode-bidi`).
- *Severity:* Medium for any Hebrew / RTL host.
- *Mitigation:* Rules 3 and 18.
- *Test:* Fixture `<html dir="rtl" lang="he">` with a log entry
  `"שגיאה: ‮txt.exe"`. Assert column order is unchanged and the cell
  text equals the input (`textContent`).

**L13. Viewport units and zoom.**
- *What happens:* `100vh` inside the panel ignores mobile browser bars;
  `html { zoom }` scales the panel together with the page.
- *Real?* REASONED (CSS Values 4; CSS `zoom`). X4 could not see a change
  from `zoom` at the pixel sampled.
- *Severity:* Low (desktop stations). *Mitigation:* Size the panel in px
  with `max-height: 100dvh`-style limits; accept zoom.

### 3.4 Events

**E1. Most UI events cross the boundary; their target becomes our host element.**
- *What happens:* "Composed" events leave the shadow tree. Outside it, the
  target is retargeted to our host element (DOM spec, "retarget").
- *Real?* VERIFIED (X5, real Playwright input). At `document` we saw
  `pointerdown`, `mousedown`, `mouseup`, `click`, `dblclick`, `keydown`,
  `keypress`, `keyup`, `beforeinput`, `input`, `focusin`, `focusout`,
  `copy` and `wheel`, all with `target = <x-panel>`. `focus` / `blur`
  reached `document` in the **capture** phase only (they don't bubble).
  **Not** seen at `document`: `change`, `submit`, `select` (not composed).
  `selectionchange` and `scroll` fire on `document` itself.
- *Severity:* High. It is the root of E2–E6.
- *Mitigation:* Rule 7.
- *Test:* See E2–E5.

**E2. Clicking the panel closes the host's "click outside" menus.**
- *What happens:* The usual code is `if (!menu.contains(event.target))
  close()`. Our host element is not inside the menu, so every click in the
  panel closes it.
- *Real?* VERIFIED (X5: hand-written handler closed its menu). With rule 7
  (stop on our host element, bubble), the menu **stayed open**.
- *Severity:* High. Any time the user opens a host dropdown and then looks
  at the panel.
- *Test:* Fixture document `click` listener (bubble) with
  `contains(e.target)`. Click several panel controls. Assert the fixture
  menu is still open.

**E3. Capture-phase host listeners still see panel events.**
- *What happens:* `stopPropagation()` on our element can't stop listeners
  that already ran in the capture phase on `window` / `document` / `body`.
  This includes the Angular CDK `OverlayOutsideClickDispatcher`
  (`body.addEventListener('pointerdown' | 'click' | 'auxclick' |
  'contextmenu', …, true)`, `@angular/cdk/fesm2022/overlay.mjs:629-633`),
  `FocusMonitor`, and the opt-in focus-trap strategy below (E6).
- *Real?* VERIFIED (X5). A CDK-style body capture listener counted 4
  "outside clicks" with or without our guard. X5b: a `window` capture guard
  that calls `stopImmediatePropagation()` does block them, **but the panel's
  own button listener then never runs** (0 clicks).
- *Severity:* Medium. CDK overlays that subscribe to `outsidePointerEvents()`
  will close when the panel is clicked. `MatSelect` (used 28 times here)
  closes on backdrop click, not this, so it stays open.
- *Mitigation:* Accept; document (rule 21). Do not install a window
  capture guard.
- *Test:* Fixture adds a body capture `click` listener. Assert the panel's
  own buttons still work (regression guard against someone adding a
  capture guard).

**E4. Typing in the panel fires the host's hotkeys.**
- *What happens:* Hotkey code usually skips events from text fields:
  `if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
  t.isContentEditable) return;`. After retargeting, `t` is our custom tag,
  so the check fails, and `a`, `/`, `Delete` etc. trigger host actions.
- *Real?* VERIFIED (X5). While typing `a/` + `Escape` + `Enter` into the
  panel's input, the host's guarded hotkey handler fired for **every** key.
  With rule 7 it fired for none.
- *Severity:* High. "Press `/` to search" or `Delete` to remove a row can
  change real data.
- *Test:* Fixture document `keydown` hotkey handler with the usual input
  guard. Type in every panel input. Assert zero host hotkey calls.

**E5. `Escape` in the panel closes the host's top overlay.**
- *What happens:* The CDK `OverlayKeyboardDispatcher` listens to `keydown`
  on `<body>` (bubble, `overlay.mjs:495`). It passes it to the top attached
  overlay, which closes `MatDialog`, `mat-select` and `mat-menu` on
  `Escape`. It does not look at the target.
- *Real?* VERIFIED with a CDK-shaped body `keydown` listener (X5: "dialog"
  closed; with rule 7 it stayed open). REASONED for the real CDK class
  (source above).
- *Severity:* Medium. *Mitigation:* Rules 7 and 8. *Test:* Same fixture
  listener. Press `Escape` in the panel filter. Assert the fixture dialog
  stays open and the panel handled `Escape` itself (clears filter / closes
  panel).

**E6. `document.activeElement` and focus events point at our host element.**
- *What happens:* While the user types in the panel,
  `document.activeElement` is our host element. Host code like "if focus is
  on `body`, the user is not typing" or "save on blur" misreads it.
  `focusout` on the host's field fires when the user clicks into the panel.
  That's normal focus loss, but `(blur)` validators and "close on blur"
  widgets react to it. The opt-in CDK `EventListenerFocusTrapInertStrategy`
  (`a11y.mjs:1321-1366`) listens to `focus` in the capture phase and pulls
  focus back into its trap. A panel input can't keep focus while such a
  trap is active.
- *Real?* VERIFIED for `activeElement` (X1-H: `X-PANEL`) and for `focus`
  reaching `document` capture (X5). REASONED for the CDK strategy (source).
- *Severity:* Low (inherent to any focusable overlay). *Mitigation:*
  Rule 16 (no surprise focus moves); document.
- *Test:* Open the panel by API without a user gesture. Assert
  `document.activeElement` did not change.

**E7. Guard placement: put it on the host element, not the shadow root.**
- *What happens:* An event whose target is our host element's own box
  (padding, or an area with no inner node under the pointer) never passes
  through the shadow root. A guard on the shadow root misses it.
- *Real?* VERIFIED (X5b). A click on an empty area of the host box reached
  `document` with a shadow-root guard (1 click), but not with a guard on
  the host element (0). Both guards let the panel's own button handler run.
- *Mitigation:* Rule 7. *Test:* Click the panel's padding. Assert the
  fixture document listener did not fire.

**E8. The event wall also hides our own debug shortcuts.**
- *What happens:* `bindShortcuts` listens on `window` (bubble). With rule 7,
  `Ctrl+Alt+Shift+D` pressed while focus is in the panel never reaches it.
- *Real?* VERIFIED (X5: 1 shortcut hit without the guard, 0 with it).
- *Severity:* Medium (the download shortcut is the main feature).
- *Mitigation:* Rule 7: the guard lets events through that match a
  configured capture chord, or the panel calls the same actions itself.
- *Test:* Focus the panel filter, press each capture chord. Assert the
  action ran once (not zero, not twice).

**E9. Copy / cut / paste inside the panel reach host clipboard handlers.**
- *What happens:* `copy` is composed. Host listeners that rewrite the
  clipboard (e.g. "copy as table", or blocking copy) act on text copied
  from the panel.
- *Real?* VERIFIED that `copy` reaches `document` (X5). REASONED for the
  rewrite effect.
- *Severity:* Low. *Mitigation:* Rule 7 (include `copy`, `cut`, `paste`).
  Copy buttons use `navigator.clipboard.writeText` first (the existing
  `copyText` sink already does). Note: its fallback appends a hidden
  `<textarea>` to `<body>` (light DOM). That briefly fires `focusin` /
  `focusout` / `copy` in the host and one MutationObserver record
  (`src/debug-capture/adapters/sinks/clipboard.sink.ts`).
- *Test:* Fixture `copy` listener on document that records calls. Select
  text in the panel, press `Ctrl+C`. Assert no call.

**E10. Selecting text in the panel fires `selectionchange` on the host document.**
- *Real?* VERIFIED (X5). It fires at `document`, so it can't be stopped.
- *Severity:* Low (rich-text editors and "share selection" tooltips may
  react). *Mitigation:* none needed; document.

**E11. React root event delegation.**
- *What happens:* React 17+ listens at its root container. If our element
  sits **inside** a React tree, React runs the `onClick` of its React
  ancestors for clicks in the panel.
- *Real?* VERIFIED (X9, React 19.3). Inside the tree: an ancestor `onClick`
  ran once per panel click. Mounted outside the root: 0.
- *Severity:* Low with rule 1. *Test:* React fixture with `onClick` on the
  app root wrapper. Click the panel. Assert 0 calls.

**E12. Drag / resize must not add global listeners.**
- *What happens:* A resize handle that listens to `mousemove` on `document`
  runs on every host mouse move. In Angular's zone, each one is a CD pass
  (P1).
- *Real?* REASONED (Pointer Events: `setPointerCapture` sends the pointer
  stream to the capturing element). *Mitigation:* Rule 19. *Test:* Drag the
  resize handle with a host document `pointermove` counter. Assert our code
  added no document-level listeners (spy on `addEventListener`).

**E13. `preventDefault()` reach.**
- *What happens:* `preventDefault()` in a listener on `window` / `document`
  affects host events too. The existing shortcut code does this only on an
  exact chord match.
- *Real?* REASONED. *Mitigation:* Rule 8. *Test:* Fixture host input:
  type all printable keys and the browser shortcuts not bound by us. Assert
  `defaultPrevented === false` for every one.

### 3.5 Focus and accessibility

**F1. Focus stealing.**
- *What happens:* Calling `.focus()` (or `autofocus`) when the panel opens
  takes focus from the host field the operator is typing in. Blur
  handlers, validation and dropdowns fire.
- *Real?* REASONED (inherent; see E6). *Severity:* Medium.
- *Mitigation:* Rule 16. *Test:* Focus a host input, open the panel by API,
  type. Assert the text went into the host input.

**F2. Tab order.**
- *What happens:* Our focusable controls join the page's Tab order at the
  end (the `<html>` mount is last in the DOM). Elements that are
  `display: none` or `inert` are not focusable.
- *Real?* REASONED (HTML "focusable area", `inert`). *Mitigation:* Rule 16
  (closed = `hidden` + `inert`). *Test:* With the panel closed, Tab through
  the whole fixture page. Assert focus never enters the panel.

**F3. Host `inert` / `aria-hidden` on body children disables or hides the panel.**
- *What happens:* Modal libraries make "everything except the modal" inert
  or `aria-hidden`. CDK Dialog sets `aria-hidden="true"` on all **siblings
  of the overlay container**, which are `<body>` children
  (`_hideNonDialogContentFromAssistiveTechnology`, `dialog.mjs:673-685`).
- *Real?* VERIFIED (X6). With `inert` set on body children, clicks on a
  body-mounted panel did nothing. With `aria-hidden` on body children, the
  panel was gone from the accessibility snapshot.
- *Severity:* Medium. An `<html>`-mounted panel is **not** a body child, so
  CDK and most "hide others" helpers skip it (REASONED from the CDK source:
  it walks `overlayContainer.parentElement.children`).
- *Mitigation:* Rule 1. *Test:* Open a `MatDialog` in the real app (or set
  `inert` / `aria-hidden` on body children in the fixture). Assert the panel
  is clickable and in the accessibility tree.

**F4. Screen reader noise.**
- *What happens:* An `aria-live` region that gets a row per request would
  talk over the host app all the time.
- *Real?* REASONED (WAI-ARIA live regions; MDN "ARIA live regions").
- *Severity:* Medium for screen-reader users. *Mitigation:* Rule 17.
- *Test:* Assert no `aria-live` attribute on any row container.

**F5. The panel is read as part of the page.**
- *What happens:* Without a role and a label, a screen reader reads the
  panel's rows as page content, with no name and no edge.
- *Real?* REASONED (WAI-ARIA landmark / dialog roles).
- *Mitigation:* Rule 17. *Test:* Accessibility snapshot shows one region or
  dialog named "Debug panel".

**F6. Inherited `lang`.**
- *What happens:* `lang` is inherited through the shadow boundary.
  English panel text on a `lang="he"` page is read with a Hebrew voice.
- *Real?* REASONED (HTML "the lang attribute"; inheritance into shadow
  trees follows the flat tree). *Mitigation:* Rule 17 (`lang="en"` on the
  inner root). *Test:* `innerRoot.closest('[lang]').lang === 'en'`.

**F7. Host e2e tests and a11y audits can see the panel.**
- *What happens:* `document.querySelectorAll` does not enter shadow roots,
  but Playwright locators (CSS and role) and axe-core **do**, for open
  shadow roots.
- *Real?* VERIFIED (X6). With two panels on the page:
  `querySelectorAll('button').length === 0`, but
  `page.getByRole('button', { name: 'Clear' }).count() === 2` and
  `page.locator('#btn').count() === 2`.
- *Severity:* Low (the panel is off unless the debug flag is set). If an
  e2e run turns the flag on, `getByRole('button', { name: 'Clear' })` in
  host tests becomes ambiguous.
- *Mitigation:* Keep the panel unmounted until first open (rule 1). Give
  panel controls names unlikely to clash ("Clear capture", not "Clear").
- *Test:* In host e2e with `?debug=1`, assert the host suite still passes.

**F8. Motion.**
- *Real?* REASONED (`prefers-reduced-motion`). *Mitigation:* Rule 17.

### 3.6 Performance

**P1. zone.js wraps listeners inside the shadow tree too.**
- *What happens:* zone.js patches `EventTarget.prototype`, so a listener
  added to any node, including inside a shadow root, runs in the zone that
  was current when it was added. In Angular's zone, each call of each
  listener ends with a CD pass.
- *Real?* VERIFIED (X7b, real `NgZone`). Listeners added in `ngZone.run`
  on the host element, the shadow root and an inner node: 20 mouse moves
  over the panel → **60 CD passes** (3 listeners × 20). A light-DOM div with
  one listener → 20.
- *Severity:* High. Hovering a row list, scrolling or typing in the panel
  would re-run the whole app's change detection, on stations that already
  stream many WebSocket frames per second.
- *Mitigation:* Rule 9. *Test:* Angular fixture (real `NgZone`): define,
  mount and open the panel from inside `ngZone.run`, move the mouse 50
  times, scroll, type. Assert `onMicrotaskEmpty` count = 0.

**P2. zone.js runs custom-element callbacks in the zone of `customElements.define`.**
- *What happens:* zone.js patches `customElements.define` and wraps
  `connectedCallback` and the other callbacks in the zone that was current
  **at define time**, not at mount time.
- *Real?* VERIFIED (X7c):

  | define in | mount in | `connectedCallback` zone | CD for 20 moves |
  |---|---|---|---|
  | root | Angular | `<root>` | 0 |
  | Angular | root | `angular` | 20 |
  | Angular | Angular | `angular` | 20 |
  | root | root | `<root>` | 0 |
  | Angular, but listeners added in `Zone.root.run` | Angular | `angular` | **0** |
  | (no custom element) plain div + shadow, made in Angular | | | 20 |

- *Severity:* High. If an Angular service lazily imports and defines the
  panel, every callback lands in Angular's zone.
- *Mitigation:* Rule 9. Wrap both the `define` call and the body of each
  callback in `Zone.root.run`. Belt and braces: it costs nothing without
  zone.js.
- *Test:* Same as P1, covering each row of the table.

**P3. `onEntry` runs in the caller's zone.**
- *What happens:* The recorder calls listeners synchronously, inside the
  code that produced the entry. Network entries come from root-zone probes.
  Console entries come from wherever `console.log` was called, often Angular
  code. A panel that calls `requestAnimationFrame` from there schedules
  another task in Angular's zone, so another CD pass per batch.
- *Real?* VERIFIED (X7). 20 entries logged from Angular code, 40 ms apart:
  a plain rAF in the listener gave **40** CD passes. Scheduling via
  `Zone.root.run` gave **20**, the same as the baseline cost of the 20
  `ngZone.run` calls themselves (0 extra).
- *Severity:* High. *Mitigation:* Rule 9. *Test:* As measured: log N
  entries from inside `ngZone.run` with the panel open. Assert the CD count
  equals the no-panel baseline.
- *Note:* The README says "a future on-screen panel must re-enter the zone
  (`NgZone.run`) to update its view". That is true for an **Angular**
  panel. A framework-free panel must do the **opposite**: stay out of the
  zone. The README line should be updated when the panel lands.

**P4. Observers created in Angular's zone.**
- *Real?* VERIFIED (X7). Created inside `ngZone.run`, then triggered 10
  times: `MutationObserver` → 10 CD passes, `IntersectionObserver` → 10,
  `ResizeObserver` → 0 (zone.js 0.13 does not patch it by default).
- *Mitigation:* Rule 9 (create all observers in the root zone). Don't rely
  on `ResizeObserver` being unpatched; a future zone.js may patch it.
- *Test:* Part of the P1 fixture.

**P5. Idle cost.**
- *What happens:* A polling timer left running while the panel is closed
  costs CPU, and in Angular's zone a CD pass per tick.
- *Real?* VERIFIED (X7: `setInterval(…, 100)` made in Angular's zone →
  11 CD passes per second).
- *Severity:* High (the panel ships in production builds and may stay
  installed for hours).
- *Mitigation:* Rule 11. *Test:* Install with the flag, keep the panel
  closed, record 1,000 entries. Assert: no host element children (or no
  host element), 0 timers / rAF scheduled by panel code (spy), 0 CD passes
  added, `onEntry` listener count 0.

**P6. Rendering thousands of rows.**
- *Real?* VERIFIED (X8). Host page with a 20,000-cell grid. Panel row = 6 cells.

  | Render | Time to build + layout | Long tasks | DOM nodes added |
  |---|---|---|---|
  | all 5,000 rows | 443 ms | 449 ms, 107 ms | 65,008 |
  | all 5,000 rows + `content-visibility: auto` | 54 ms | 55 ms, 113 ms | 65,008 |
  | virtual window, 60 rows | 6 ms | none | 788 |

- *Severity:* High. A 450 ms freeze on open is visible in the host app (and
  repeats on each tab switch if tabs re-render).
- *Mitigation:* Rule 10 (virtualise). `content-visibility: auto` helps
  layout but keeps all nodes in memory; use it only for long detail views.
- *Test:* Open with 5,000 buffered entries. Assert a `PerformanceObserver`
  sees no long task over 50 ms caused by open, and the shadow root has
  under 2,000 nodes.

**P7. Streaming updates.**
- *Real?* VERIFIED (X8). 1,000 entries in bursts of 50 every 10 ms (a
  chatty socket), panel open, auto-scroll on:

  | Strategy | Main-thread time | Renders |
  |---|---|---|
  | append + scroll per entry | 403 ms | 1,000 |
  | queue, flush once per rAF | 97 ms | 20 |

- *Mitigation:* Rule 10. With virtualisation, the flush only updates
  counts and the visible window, so it is cheaper still.
- *Test:* Push 200 entries/second for 10 s. Assert total panel script time
  stays under a budget (e.g. 5% of wall time) and no long tasks.

**P8. Panel changes vs host layout.**
- *What happens:* A panel mutation could force the browser to lay out the
  host page again.
- *Real?* VERIFIED (X8). With a fixed, sized, `overflow: auto` host
  element: 300 × (change a panel cell + read host layout) took 26 ms both
  with and without `contain: strict`. Chromium already treats such a box as
  a layout boundary.
- *Severity:* Low. *Mitigation:* Add `contain: strict` anyway (rule 2). It
  is cheap insurance if the host element's size ever becomes `auto`.

**P9. Host MutationObservers see our element, not its insides.**
- *What happens:* Analytics, CDK `ContentObserver`, and devtools-like
  scripts often observe `body` with `subtree: true`.
- *Real?* VERIFIED (X6). Observer on `body` (`childList`, `subtree`,
  `attributes`, `characterData`). Mounting the panel = 1 record. Adding
  1,000 rows inside the shadow root = **0** records. Two attribute changes
  on our host element = 2 more records.
- *Severity:* Low. Nothing at all with an `<html>` mount and a body observer
  (REASONED, since the host element is outside the observed subtree).
- *Mitigation:* Rules 1 and 15 (mount once; never toggle host attributes).
- *Test:* Fixture body observer. Open, use, close the panel 10 times. Assert
  at most 1 record.

**P10. Very large cells.**
- *Real?* VERIFIED (X8). A 32 KB JSON body in one `<pre>`: 6 ms with
  `pre-wrap`, 2 ms with `nowrap`. Fine once; costly ×100.
- *Mitigation:* Rule 10 (collapsed by default; expand one at a time).

**P11. Feedback loops through our own recorder.**
- *What happens:* The recorder captures `console.*`, window errors and
  unhandled rejections. A panel that logs, throws from an event handler,
  or leaves a rejected promise creates an entry, which calls `onEntry`,
  which renders, which may log or throw again. The recorder isolates
  **throwing listeners** (`recorder.ts` `notify()`), but not errors thrown
  later from rAF / event handlers.
- *Real?* REASONED (from `src/debug-capture/core/recorder.ts` and the probe
  design). The `ResizeObserver` case is VERIFIED (P12).
- *Severity:* Medium. *Mitigation:* Rule 12. *Test:* Make a render throw (test
  hook). Assert one error entry at most, no growth over 1 s, and the panel
  still renders the next entry.

**P12. `ResizeObserver` loops raise window errors.**
- *What happens:* If a `ResizeObserver` callback changes the size it
  watches, the browser fires an `ErrorEvent` on `window`:
  "ResizeObserver loop completed with undelivered notifications."
- *Real?* VERIFIED (X6: two `window` `error` events in 300 ms).
- *Severity:* Medium. Our global-error probe records it (P11). The host's
  error handler, Sentry-like reporting and Angular `ErrorHandler` may count
  it as an app error.
- *Mitigation:* Rule 12. *Test:* Resize the panel and the window 50 times.
  Assert no `window` `error` events.

**P13. Memory.**
- *What happens:* Entries are frozen and already held by the recorder's
  ring buffer, so holding references costs nothing extra. DOM nodes are the
  real cost: about 13 nodes per row (X8: 65,008 for 5,000 rows).
- *Real?* VERIFIED for node counts (X8). REASONED for the rest.
- *Mitigation:* Rules 10 and 11. Never deep-copy entries; drop rows the
  recorder evicted; on close, remove rows from the DOM.
- *Test:* Open/close 20 times with 5,000 entries. Assert the CDP `Nodes`
  metric returns to its baseline (± a few).

### 3.7 DOM and lifecycle

**D1. Where to mount.**
- *Real?* VERIFIED via L1, L2, L3, S13, F3, D2. `<html>` (after `<body>`)
  + top layer avoids body transforms, body sibling selectors, body
  opacity/filter, z-index ties, body-children `inert` / `aria-hidden`, and
  `createRoot(document.body)`.
- *Costs of the `<html>` mount:* an element after `<body>` is invalid for
  the HTML parser but fine in the DOM; Chromium renders it. Host CSS like
  `html > *` or `:root > :last-child`, or scripts reading
  `document.documentElement.lastChild`, would see it (REASONED, rare).
- *Test:* Assert `host.parentNode === document.documentElement`.

**D2. A host that renders into `document.body` deletes our element.**
- *Real?* VERIFIED (X9). React 19 `createRoot(document.body).render(…)`
  removed a body-mounted panel; an `<html>`-mounted one survived two
  renders. The same applies to any `document.body.innerHTML = …` or
  `replaceChildren()` (REASONED).
- *Mitigation:* Rules 1 and 20. *Test:* React fixture as above, plus a plain
  fixture that runs `document.body.replaceChildren()`. Assert the panel
  opens again on the next toggle.

**D3. Server-side rendering and hydration.**
- *What happens:* Hydration expects the server HTML inside its container,
  unchanged.
- *Real?* VERIFIED (X9) for React 19.3. Our element inserted **inside** the
  container (first or last) before `hydrateRoot` gave no recoverable errors,
  and the element stayed. Outside the container: no effect. REASONED for
  React 18 (a mismatch there makes React re-render the root on the client,
  which can drop unknown nodes) and Angular 16 non-destructive hydration
  (`provideClientHydration`). A node inside `<app-root>` would not match the
  server DOM.
- *Mitigation:* Rule 1 (never inside a framework container) and lazy mount
  on first open, which is long after hydration.
- *Test:* Covered by D1 (`parentNode` check) and by mounting only on open.

**D4. `document.body` may not exist yet.**
- *What happens:* `installDebugCapture()` must run first in the app. If a
  host calls it from a classic `<script>` in `<head>`, `document.body` is
  `null`. `document.documentElement` always exists.
- *Real?* REASONED (HTML parsing). *Mitigation:* Rule 1 (mount lazily on
  first open; `<html>` exists from the start). *Test:* Install from a
  `<head>` script; press the toggle before `DOMContentLoaded` (or assert
  no throw).

**D5. `customElements.define` with a used name throws.**
- *Real?* VERIFIED (X6): `NotSupportedError: … the name "x-panel" has
  already been used with this registry`.
- *What happens:* Two copies of the panel on one page (micro-frontends, or
  an app that bundles it twice, or two versions) means the second define
  throws. If not caught, that breaks the importing app's startup.
- *Severity:* Medium. *Mitigation:* Rule 14. (Scoped custom element
  registries would remove this, but they cannot be relied on yet.)
- *Test:* Define a different class under the panel's name first. Then
  install the panel. Assert no throw and a clear console-free outcome
  (e.g. `install` returns `null`).

**D6. Several apps / several recorders on one page; iframes.**
- *What happens:* Two apps that each call `installDebugCapture()` patch the
  globals twice. Each panel would only see its own recorder. A panel in the
  top page sees nothing from iframes (they have their own `window`,
  `console`, `fetch`).
- *Real?* REASONED. *Mitigation:* One panel per page (rule 14). Document
  that iframes are out of scope.

**D7. An `id` on our element becomes a `window` property.**
- *Real?* VERIFIED (X6). `id="debug-panel"` →
  `window['debug-panel'] === ourElement`. Built-in names (`window.name`)
  are not shadowed, but host globals with the same name read by bare name
  can be.
- *Mitigation:* Rule 15 (no `id` on the host element).

**D8. Host clears the page or navigates.**
- *What happens:* SPA route changes don't touch `<html>` children. A full
  reload loses the panel (and the capture) by design. `document.open()`
  wipes everything.
- *Real?* REASONED. *Mitigation:* Rule 20.

### 3.8 Security

**SEC1. CSP `style-src` without `'unsafe-inline'`.**
- *Real?* VERIFIED (X10), header
  `default-src 'self'; style-src 'self'; script-src 'self'`:

  | Technique | Result |
  |---|---|
  | `<style>` element in the shadow root | **blocked** |
  | `adoptedStyleSheets` + `CSSStyleSheet.replaceSync()` | applied |
  | `el.setAttribute('style', …)` | **blocked** |
  | `el.style.color = …` (CSSOM) | applied |
  | `innerHTML` with `style="…"` in the markup | element created, style **blocked** |
  | inline `onclick="…"` attribute | **blocked** (`script-src`) |

- *Severity:* High for portability (our own app has no CSP today; hosts that
  copy the folder may).
- *Mitigation:* Rule 4. *Test:* Run the whole panel e2e suite under that CSP
  header. Assert no `securitypolicyviolation` events and a correct visual
  snapshot.

**SEC2. Blocked attempts report to the host.**
- *What happens:* Each blocked style / script / Trusted Types call fires a
  `securitypolicyviolation` event on the host document, and is sent to the
  host's CSP `report-uri` / `report-to` endpoint.
- *Real?* VERIFIED (X10: `style-src-elem`, `style-src-attr`,
  `script-src-attr`, `require-trusted-types-for` and `trusted-types`
  violations were all seen by a document listener).
- *Severity:* Medium. It pollutes the host's security reports and may page
  someone. *Test:* As SEC1 (zero violations).

**SEC3. Trusted Types.**
- *Real?* VERIFIED (X10), with `require-trusted-types-for 'script';
  trusted-types 'none'`. `shadowRoot.innerHTML = …`, `setHTMLUnsafe()` and
  `setAttribute('onclick', …)` **throw `TypeError`**.
  `trustedTypes.createPolicy('debug-panel', …)` **throws** (policy name not
  allowed). `textContent` works.
- *Mitigation:* Rule 4 (DOM APIs + `textContent` only; no policy).
- *Test:* Run the suite under that header. Assert no `TypeError`s and no
  violations.

**SEC4. Rendering captured data safely.**
- *What happens:* Response bodies, WebSocket frames, log strings, URLs and
  header values are attacker-influenced (a server, a user name, a
  third-party API). Using `innerHTML`, or turning captured URLs into links,
  is an XSS hole in a production page.
- *Real?* VERIFIED that `textContent` renders `<img src=x onerror=…>` as
  inert text (X10). REASONED for the rest (OWASP XSS Prevention Cheat
  Sheet).
- *Severity:* High. *Mitigation:* Rule 4. If a URL must be clickable later:
  allow only `http:` / `https:` after `new URL()` parsing, with
  `rel="noopener noreferrer"`. Better: show it as text with a "copy"
  button.
- *Test:* Feed entries holding `<img src=x onerror=window.__pwned=1>`,
  `javascript:window.__pwned=1` URLs, and `</style><script>…` strings into
  every tab and detail view. Assert `window.__pwned` is undefined and the
  text is shown as typed.

**SEC5. Bidi spoofing in captured text.**
- *Real?* REASONED (Unicode Bidi; "Trojan Source" CVE-2021-42574).
  *Mitigation:* Rule 18; optionally show control characters as visible
  `‮` marks. *Test:* See L12.

**SEC6. What the panel exposes.**
- *What happens:* The panel shows only **redacted** entries (redaction is
  done before storage). But it puts business data on screen in production
  builds for anyone who knows `?debug=1`. With an open shadow root, host
  scripts and browser extensions can read the panel's DOM. They could
  already call the recorder; it is the same data.
- *Real?* REASONED (`docs/intent/debug-capture.md` §4). *Severity:* Low,
  same as the existing capture. *Mitigation:* Keep the open shadow root
  (testability). Document it next to "Be careful with the files".

**SEC7. Separate-window mode (later).**
- *What happens:* `window.open` needs a user gesture (popup blockers). The
  popup has its own document, so the style and event risks above disappear.
  But it depends on the opener: an opener reload kills the feed. The
  popup's timers are throttled when it is in the background. With a
  same-origin direct reference, code from the opener realm runs on the
  popup's DOM. zone.js in the opener does **not** patch the popup's
  `EventTarget`, but promises from the opener realm are still zone-aware.
  A `postMessage` / `BroadcastChannel` design needs origin checks.
- *Real?* REASONED (HTML "window.open", "Timers"; zone.js patches only its
  own realm's prototypes). *Mitigation:* Out of scope for v1; note in the
  spec as the fix for L4, L6, E3, F3.

### 3.9 Anything else

**M1. Host error monitors and analytics count our problems.**
- Covered by P11 and P12. Any error or rejection from panel code reaches
  `window.onerror`, Angular's `ErrorHandler` (if thrown inside the zone),
  and third-party reporters. Rule 12. VERIFIED (via P12).

**M2. Our toggle shortcut can clash with the host.**
- The capture uses `Ctrl+Alt+Shift+{D,C,X}`. Pick the panel toggle from the
  same three-modifier family (e.g. `Ctrl+Alt+Shift+P`), configurable, and
  `false` to disable, like `shortcuts` today. `AltGr` on some layouts sends
  `Ctrl+Alt`; with `Shift` added this stays rare. REASONED. *Test:* Shortcut
  spec in the style of `install/shortcuts.spec.ts`.

**M3. The README guidance on zones must change.**
- See P3. The current text tells a future panel to use `NgZone.run`. That
  is right only for an Angular-rendered panel. REASONED.

---

## 4. The "hostile host" test fixture

One static page (plus an Angular variant and a React variant) that switches
every risk above on at once. All panel e2e tests run against it. Contents:

- **CSS:** all S1 inherited properties on `html`/`body`;
  `html { font-size: 10px }`; `<html dir="rtl" lang="he">`;
  `:root { --dcp-bg: hotpink; --bg: hotpink }`;
  `@property --dcp-bg { syntax: '<length>'; inherits: false;
  initial-value: 0px }`; `* { margin: 5px; transition: all 1s; animation:
  spin 1s infinite }`; `body > *, html > * { position: relative;
  z-index: 1; display: flex }`; `dc-debug-panel { display: none
  !important }`; `*:focus { outline: 5px solid red }`;
  `body { transform: translateX(0); opacity: .9 }`;
  `body > :last-child { outline: 3px solid red }`;
  `@media print { … }` defaults.
- **Headers:** `Content-Security-Policy: default-src 'self'; style-src
  'self'; script-src 'self'; require-trusted-types-for 'script';
  trusted-types 'none'`.
- **Listeners:** document `click` "outside" handler; body capture
  `pointerdown` / `click` counter (CDK style); document `keydown` hotkeys
  with the usual input guard; body `keydown` `Escape` "dialog"; window
  non-passive `wheel` + `preventDefault`; document `copy` recorder;
  document `securitypolicyviolation` recorder; window `error` /
  `unhandledrejection` recorder; body `MutationObserver` (subtree,
  attributes).
- **Overlays:** a full-screen `z-index: 2147483647` div appended after open;
  a host `popover="auto"`; optional native modal `<dialog>` and fullscreen
  toggles (for the documented-limit tests).
- **Angular variant:** real `NgZone` + `onMicrotaskEmpty` counter; panel
  defined, mounted and opened from inside `ngZone.run`.
- **React variant:** `createRoot(document.body)`; ancestor `onClick`
  counter; `hydrateRoot` over server markup.
- **Data:** 5,000 buffered entries, a 200/s stream, and the SEC4 / L12 hostile
  strings.

Pass criteria: every test named in section 3.

---

## 5. Open questions for the spec

1. **Top layer requires `popover`** (Chromium 114+). Do any target stations
   run older Chromium? If so, keep the `position: fixed` fallback and accept
   L1 for `<html>` transforms.
2. **Should the panel ever block host capture-phase listeners?** This
   research says no (E3: it breaks our own handlers). Agree before the spec.
3. **What happens under a host modal `<dialog>` / fullscreen?** Show a hint
   in the panel, or stay silent? Separate window in v1 or later?
4. **Copy buttons:** reuse `copyText` (its `execCommand` fallback touches
   `<body>`, E9), or Clipboard API only?
5. **Panel element name** (versioned, e.g. `dc-debug-panel`) and what
   happens on a clash (D5): reuse the existing definition, or do nothing?

---

## Sources

- CSS Cascade 5: §6.1 cascade context (encapsulation; important inner
  wins), `all` shorthand (excludes `direction`, `unicode-bidi`, custom
  properties) — https://www.w3.org/TR/css-cascade-5/
- CSS Scoping 1 (`:host`, tree-scoped names) —
  https://www.w3.org/TR/css-scoping-1/
- CSS Transforms 1 / Filter Effects 1 / CSS Containment 2 (containing block
  for fixed descendants) — https://www.w3.org/TR/css-transforms-1/ ;
  MDN "position: fixed" ("containing block")
- CSS Text Decoration 3 §2.1 (decorations not propagated to out-of-flow
  descendants) — https://www.w3.org/TR/css-text-decor-3/
- CSS Properties and Values API 1 (`@property` is global) —
  https://www.w3.org/TR/css-properties-values-api-1/
- DOM Standard: event dispatch, "retarget", `composed` —
  https://dom.spec.whatwg.org/#retarget
- HTML Standard: top layer, popover light dismiss, "modal dialogs and
  inert subtrees", named access on `Window`, focusable areas, `lang` —
  https://html.spec.whatwg.org/
- Fullscreen API — https://fullscreen.spec.whatwg.org/
- CSP Level 3 (`style-src-elem`, `style-src-attr`; CSSOM not covered) —
  https://www.w3.org/TR/CSP3/
- Trusted Types — https://w3c.github.io/trusted-types/dist/spec/
- MDN: `overscroll-behavior`, ARIA live regions, `setPointerCapture`,
  `prefers-reduced-motion`
- Angular CDK 16.2.14 sources in `node_modules/@angular/cdk/fesm2022/`:
  `overlay.mjs` (keyboard dispatcher :495, outside-click dispatcher
  :629-633), `a11y.mjs` (`EventListenerFocusTrapInertStrategy` :1321-1366),
  `dialog.mjs` (`_hideNonDialogContentFromAssistiveTechnology` :673-685),
  `platform.mjs` (`_getEventTarget` uses `composedPath()[0]`, :290)
- zone.js 0.13.3 (patches `EventTarget`, timers, rAF, `MutationObserver`,
  `IntersectionObserver`, `customElements.define`; not `ResizeObserver` by
  default)
- This repo: `src/debug-capture/core/recorder.ts` (`notify()` isolates
  throwing listeners), `src/debug-capture/install/shortcuts.ts`,
  `src/debug-capture/adapters/sinks/clipboard.sink.ts`,
  `src/debug-capture/adapters/probes/http/outside-zones.ts`
