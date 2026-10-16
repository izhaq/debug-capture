/**
 * The panel's colour tokens, exactly the HLD §5.4 table (names without the
 * `--dcp-` prefix). `npm run contrast` runs `scripts/theme-check.mjs`, which
 * parses this file and fails on any name or value that differs from the HLD,
 * so the contrast numbers the HLD proves are the colours that ship.
 * Keep the plain `name: '#rrggbb'` shape inside `dark: { … }` and
 * `light: { … }`: the check reads this file as text.
 */

/** A theme the panel can show; "Auto" is no `data-theme` and follows the OS. */
export type ThemeName = 'dark' | 'light';

/** Every HLD §5.4 token, without the `--dcp-` prefix. */
export type TokenName =
  | 'bg'
  | 'bg-elevated'
  | 'bg-row-alt'
  | 'bg-hover'
  | 'bg-selected'
  | 'divider'
  | 'border-control'
  | 'text'
  | 'text-muted'
  | 'text-faint'
  | 'accent'
  | 'success'
  | 'info'
  | 'warning'
  | 'error'
  | 'json-key'
  | 'json-string'
  | 'json-number'
  | 'json-literal'
  | 'match-bg';

/** One theme's token values (`#rrggbb`). */
export type ThemeTokens = Readonly<Record<TokenName, string>>;

/** HLD §5.4, both themes. */
export const TOKENS: Readonly<Record<ThemeName, ThemeTokens>> = {
  dark: {
    bg: '#1e1f22',
    'bg-elevated': '#26282c',
    'bg-row-alt': '#222428',
    'bg-hover': '#2d3036',
    'bg-selected': '#1b3152',
    divider: '#3a3d43',
    'border-control': '#7a8089',
    text: '#e6e7ea',
    'text-muted': '#a9aeb8',
    'text-faint': '#a3a9b3',
    accent: '#6aaeff',
    success: '#56c98a',
    info: '#5cc8dc',
    warning: '#e5b84b',
    error: '#ff8a80',
    'json-key': '#9cdcfe',
    'json-string': '#e0a77f',
    'json-number': '#b5cea8',
    'json-literal': '#79b8ff',
    'match-bg': '#5a4a16',
  },
  light: {
    bg: '#ffffff',
    'bg-elevated': '#f4f5f7',
    'bg-row-alt': '#f8f9fa',
    'bg-hover': '#eceef1',
    'bg-selected': '#e1ecff',
    divider: '#d6d9de',
    'border-control': '#7a828b',
    text: '#1f2328',
    'text-muted': '#57606a',
    'text-faint': '#545d68',
    accent: '#0757b5',
    success: '#146a2c',
    info: '#00657a',
    warning: '#7d5400',
    error: '#b0141f',
    'json-key': '#0451a5',
    'json-string': '#a31515',
    'json-number': '#08613f',
    'json-literal': '#0000c4',
    'match-bg': '#ffe58a',
  },
};
