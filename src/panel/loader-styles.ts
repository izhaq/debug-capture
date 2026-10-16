import { LAUNCHER_TOKENS, LauncherTokens } from './launcher-tokens';

/** The panel's inner root (the shell the UI renders into); tokens and the S-04 theme hang off this class. */
export const ROOT_CLASS = 'dcp-root';
export const LAUNCHER_CLASS = 'dcp-launcher';
export const COUNT_CLASS = 'dcp-launcher-count';

/**
 * Colours as plain values, not `var(--dcp-…)`: a host `@property --dcp-bg
 * { syntax: '<length>' }` turns our custom property into `0px` and every
 * `var()` with it (research S4), but cannot touch a literal colour.
 */
function theme(t: LauncherTokens, scheme: string): string {
  return (
    `.${LAUNCHER_CLASS},.${ROOT_CLASS}{color-scheme:${scheme};color:${t['--dcp-text']}}` +
    `.${LAUNCHER_CLASS}{background:${t['--dcp-bg-elevated']};border-color:${t['--dcp-border-control']}}` +
    `.${LAUNCHER_CLASS}:hover{background:${t['--dcp-bg-hover']}}` +
    `.${LAUNCHER_CLASS}:focus-visible{outline:2px solid ${t['--dcp-accent']};outline-offset:2px}` +
    `.${COUNT_CLASS}{color:${t['--dcp-error']}}` +
    `.${ROOT_CLASS}{background:${t['--dcp-bg']};border-top:1px solid ${t['--dcp-border-control']}}`
  );
}

/**
 * The loader's one stylesheet (adopted, never a `<style>` — ISO-04).
 *
 * `:host`: everything `!important`, because inner `!important` beats every
 * outer rule — `* {}`, `body > *`, a tag rule, even an inline `style` — while
 * a normal `:host` rule loses to all of them (ISO-02, research S6). `all:
 * initial` also cuts every inherited value at the host; `direction` and
 * `unicode-bidi` are the two it skips, so they are set too (S2). The element
 * covers the viewport but takes no pointer events (ISO-01); only the launcher
 * and the panel root do.
 *
 * Inner nodes set every value they need in px with system fonts (ISO-03),
 * and nothing here is global (no `@font-face`, `@property` — ISO-05).
 */
export const LOADER_CSS =
  ':host{all:initial!important;display:block!important;position:fixed!important;inset:0!important;' +
  'z-index:2147483647!important;contain:strict!important;pointer-events:none!important;' +
  'direction:ltr!important;unicode-bidi:isolate!important}' +
  // Our top-layer element has a ::backdrop the size of the viewport; a host
  // `::backdrop {}` rule (meant for its own dialogs) would tint the page.
  ':host::backdrop{display:none!important}' +
  '@media print{:host{display:none!important}}' +
  '[hidden]{display:none!important}' +
  `.${LAUNCHER_CLASS},.${ROOT_CLASS}{box-sizing:border-box;margin:0;pointer-events:auto;direction:ltr;` +
  'font:400 12px/1.4 system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;letter-spacing:normal;' +
  'text-align:left;text-transform:none;white-space:normal;cursor:auto}' +
  `.${LAUNCHER_CLASS}{position:absolute;right:12px;bottom:12px;display:flex;align-items:center;gap:4px;` +
  'height:28px;padding:0 10px;border:1px solid;border-radius:6px;font-weight:600;cursor:pointer}' +
  `.${ROOT_CLASS}{position:absolute;left:0;right:0;bottom:0;height:40%;min-height:160px;overflow:auto;` +
  'overscroll-behavior:contain}' +
  `.${ROOT_CLASS}:focus{outline:none}` +
  theme(LAUNCHER_TOKENS.light, 'light') +
  `@media (prefers-color-scheme:dark){${theme(LAUNCHER_TOKENS.dark, 'dark')}}`;
