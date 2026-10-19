import { ThemeTokens, TokenName, TOKENS } from './tokens';

/**
 * The base theme CSS (S04-02, HLD §5.3–§5.7): tokens on `.dcp-root`, the
 * inherited values every host could change (ISO-03), focus, disabled, badges,
 * search matches, icons, reduced motion and forced colours. Built once, at
 * module load, from `TOKENS`.
 *
 * Rules that keep it safe inside any host: px only (never `rem`, which follows
 * the host's root font size), no `@font-face`, `@property` or `@import`
 * (ISO-05), and every rule scoped under `.dcp-root` or a `dcp-` class.
 */

/** Text size setting (HLD §4.10): `data-text-size` on `.dcp-root`; no attribute = normal. */
export type TextSize = 'small' | 'normal' | 'large';

/** List row height in px per text size (HLD §5.3). */
export const ROW_HEIGHTS: Readonly<Record<TextSize, number>> = { small: 20, normal: 22, large: 26 };

/** UI, data and meta font sizes in px per text size (HLD §5.5). */
const FONT_SIZES: Readonly<Record<TextSize, readonly [ui: number, data: number, meta: number]>> = {
  small: [11, 11, 10],
  normal: [12, 12, 11],
  large: [14, 14, 13],
};

/** Opacity of the badge background over `--dcp-bg` (HLD §5.4). */
const BADGE_TINT = 0.12;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * `top` at `alpha` over the opaque `bottom`, rounded per channel — the same
 * maths as `scripts/contrast-check.mjs`, so the badge colours that ship are
 * the ones the contrast check measured. Precomputed, not `color-mix()`, so
 * the contrast check can measure the exact colour that ships.
 */
export function blendHex(top: string, bottom: string, alpha: number): string {
  const t = rgb(top);
  const b = rgb(bottom);
  return (
    '#' +
    t
      .map((c, i) =>
        Math.round(c * alpha + (b[i] ?? 0) * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/**
 * The badge fills derived from the tokens, as custom properties
 * `--dcp-badge-muted-bg` / `--dcp-badge-warning-bg` (opaque, HLD §5.4).
 */
function derived(t: ThemeTokens): string {
  return (
    `--dcp-badge-muted-bg:${blendHex(t['text-muted'], t.bg, BADGE_TINT)};` +
    `--dcp-badge-warning-bg:${blendHex(t.warning, t.bg, BADGE_TINT)};`
  );
}

function colours(theme: 'dark' | 'light'): string {
  const t = TOKENS[theme];
  const names = Object.keys(t) as TokenName[];
  return names.map((name) => `--dcp-${name}:${t[name]};`).join('') + derived(t) + `color-scheme:${theme};`;
}

function sizes(size: TextSize): string {
  const [ui, data, meta] = FONT_SIZES[size];
  return `--dcp-fs-ui:${ui}px;--dcp-fs-data:${data}px;--dcp-fs-meta:${meta}px;--dcp-row-h:${ROW_HEIGHTS[size]}px;`;
}

const FONT_UI = 'system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
const FONT_MONO = 'ui-monospace,"Cascadia Mono",Consolas,"Liberation Mono",Menlo,monospace';

/** Forced colours (HLD §5.4): every token becomes a system colour. */
const FORCED_TOKENS =
  '--dcp-bg:Canvas;--dcp-bg-elevated:Canvas;--dcp-bg-row-alt:Canvas;--dcp-bg-hover:Canvas;' +
  '--dcp-bg-selected:Highlight;--dcp-divider:GrayText;--dcp-border-control:ButtonText;' +
  '--dcp-text:CanvasText;--dcp-text-muted:GrayText;--dcp-text-faint:GrayText;--dcp-accent:Highlight;' +
  '--dcp-success:CanvasText;--dcp-info:CanvasText;--dcp-warning:CanvasText;--dcp-error:CanvasText;' +
  '--dcp-json-key:CanvasText;--dcp-json-string:CanvasText;--dcp-json-number:CanvasText;--dcp-json-literal:CanvasText;' +
  '--dcp-match-bg:Mark;--dcp-badge-muted-bg:Canvas;--dcp-badge-warning-bg:Canvas;';

/** The base theme stylesheet text. */
export const THEME_CSS = [
  // Tokens and sizes. Dark is the default; light by attribute or, with no
  // attribute (Auto, D-13), by the OS setting — no script involved.
  `.dcp-root{${colours('dark')}${sizes('normal')}` +
    `--dcp-font-ui:${FONT_UI};--dcp-font-mono:${FONT_MONO};` +
    '--dcp-control-h:24px;--dcp-bar-h:32px;--dcp-status-h:22px;--dcp-icon:14px;' +
    '--dcp-space-1:2px;--dcp-space-2:4px;--dcp-space-3:8px;--dcp-space-4:12px;--dcp-space-5:16px;' +
    '--dcp-radius:4px;--dcp-radius-pop:6px;' +
    // ISO-03: every inherited value the host could have changed, set here.
    'font-family:var(--dcp-font-ui);font-size:var(--dcp-fs-ui);font-weight:400;font-style:normal;' +
    'font-variant:normal;font-stretch:normal;font-kerning:auto;font-feature-settings:normal;' +
    'font-variation-settings:normal;line-height:1.4;letter-spacing:normal;word-spacing:normal;' +
    'text-align:left;text-indent:0;text-transform:none;text-shadow:none;text-decoration:none;' +
    'white-space:normal;word-break:normal;overflow-wrap:normal;hyphens:manual;tab-size:8;' +
    'direction:ltr;writing-mode:horizontal-tb;color:var(--dcp-text);background-color:var(--dcp-bg);' +
    'visibility:visible;cursor:default;list-style:none;quotes:auto;caret-color:auto;' +
    'border-collapse:separate;border-spacing:0;empty-cells:show;caption-side:top;' +
    '-webkit-text-size-adjust:100%;text-size-adjust:100%;-webkit-font-smoothing:auto}',
  `.dcp-root[data-theme="light"]{${colours('light')}}`,
  `@media (prefers-color-scheme:light){.dcp-root:not([data-theme="dark"]){${colours('light')}}}`,
  `.dcp-root[data-text-size="small"]{${sizes('small')}}`,
  `.dcp-root[data-text-size="large"]{${sizes('large')}}`,
  '.dcp-root,.dcp-root *,.dcp-root ::before,.dcp-root ::after{box-sizing:border-box}',
  '.dcp-root [hidden]{display:none!important}',
  '.dcp-root button,.dcp-root input,.dcp-root select,.dcp-root textarea{font:inherit;color:inherit;' +
    'letter-spacing:inherit;margin:0}',
  '.dcp-root ::selection{background-color:var(--dcp-bg-selected);color:var(--dcp-text)}',
  // §5.7 focus: keyboard only; 1 px outside on controls, inset where a scroll area would clip it.
  '.dcp-root :focus{outline:none}',
  '.dcp-root :focus-visible{outline:2px solid var(--dcp-accent);outline-offset:1px}',
  '.dcp-root .dcp-tab:focus-visible,.dcp-root .dcp-row:focus-visible,.dcp-root [role="row"]:focus-visible,' +
    '.dcp-root [role="option"]:focus-visible,.dcp-root [role="treeitem"]:focus-visible,' +
    '.dcp-root .dcp-focus-inset:focus-visible{outline-offset:-2px}',
  '.dcp-root :disabled,.dcp-root [aria-disabled="true"]{opacity:.5;cursor:default}',
  // Text helpers views share.
  '.dcp-data{font-family:var(--dcp-font-mono);font-size:var(--dcp-fs-data)}',
  '.dcp-meta{font-family:var(--dcp-font-mono);font-size:var(--dcp-fs-meta);color:var(--dcp-text-faint)}',
  '.dcp-tone-text{color:var(--dcp-text)}.dcp-tone-muted{color:var(--dcp-text-muted)}' +
    '.dcp-tone-faint{color:var(--dcp-text-faint)}.dcp-tone-success{color:var(--dcp-success)}' +
    '.dcp-tone-info{color:var(--dcp-info)}.dcp-tone-warning{color:var(--dcp-warning)}' +
    '.dcp-tone-error{color:var(--dcp-error)}',
  '.dcp-icon{width:var(--dcp-icon);height:var(--dcp-icon);flex:none;vertical-align:-2px;overflow:visible}',
  // §5.4 badges: colour on an opaque 12 % fill, so no row tint lowers the contrast.
  '.dcp-badge{display:inline-flex;align-items:center;gap:2px;height:16px;padding:0 4px;border-radius:4px;' +
    'font-family:var(--dcp-font-ui);font-size:var(--dcp-fs-meta);font-weight:400;font-style:normal;' +
    'line-height:16px;white-space:nowrap;vertical-align:1px;' +
    'color:var(--dcp-text-muted);background-color:var(--dcp-badge-muted-bg)}',
  '.dcp-badge--redacted,.dcp-badge--pending{color:var(--dcp-text-muted);background-color:var(--dcp-badge-muted-bg)}',
  '.dcp-badge--truncated{color:var(--dcp-warning);background-color:var(--dcp-badge-warning-bg)}',
  '.dcp-badge>.dcp-icon{width:12px;height:12px;vertical-align:0}',
  // §5.7 search match.
  '.dcp-match{background-color:var(--dcp-match-bg);color:var(--dcp-text);padding:0;border-radius:0}',
  // HLD §5.7: no motion.
  '@media (prefers-reduced-motion:reduce){.dcp-root,.dcp-root *,.dcp-root ::before,.dcp-root ::after{' +
    'transition:none!important;animation:none!important;scroll-behavior:auto!important}}',
  // `[class]` lifts the specificity above the theme rules, so this wins in every theme.
  '@media (forced-colors:active){' +
    `.dcp-root[class]{${FORCED_TOKENS}}` +
    '.dcp-match{forced-color-adjust:none;background-color:Highlight;color:HighlightText;' +
    'background-color:Mark;color:MarkText}' +
    '.dcp-badge{border:1px solid currentColor}' +
    '.dcp-root :focus-visible{outline-color:Highlight}}',
].join('\n');
