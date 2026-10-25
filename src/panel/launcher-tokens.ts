/**
 * The few HLD §5.4 colour tokens the loader's own sheet needs (launcher and
 * the empty panel shell), with the same names and values as the HLD table.
 * They live here, not in the P2 theme, because the loader may not import the
 * UI chunk (≤ 5.5 kB, NFR-SIZE-01). `scripts/theme-check.mjs` (track 04a)
 * compares every entry with the HLD table, so a token change cannot drift.
 */
export const LAUNCHER_TOKENS = {
  dark: {
    '--dcp-bg': '#1e1f22',
    '--dcp-bg-elevated': '#26282c',
    '--dcp-bg-hover': '#2d3036',
    '--dcp-border-control': '#7a8089',
    '--dcp-text': '#e6e7ea',
    '--dcp-accent': '#6aaeff',
    '--dcp-error': '#ff8a80',
  },
  light: {
    '--dcp-bg': '#ffffff',
    '--dcp-bg-elevated': '#f4f5f7',
    '--dcp-bg-hover': '#eceef1',
    '--dcp-border-control': '#7a828b',
    '--dcp-text': '#1f2328',
    '--dcp-accent': '#0757b5',
    '--dcp-error': '#b0141f',
  },
} as const;

/** One theme's token names and values. */
export type LauncherTokens = Readonly<Record<keyof (typeof LAUNCHER_TOKENS)['dark'], string>>;
