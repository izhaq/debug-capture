import type { Dom, ShortcutConfig } from '../views';

/** What Settings › About shows (`FR-BG-09`, `D-42`): read from the options, never guessed. */
export interface AboutInfo {
  readonly version: string;
  /** The panel's toggle chord; `false` when none is bound. */
  readonly toggle: string | false;
  /** The activation chord when the panel was installed by `installDebugActivation`; `false` leaves its row out. */
  readonly activation: string | false;
  /** The controller's chords; `null` with `shortcuts: false`. */
  readonly capture: ShortcutConfig | null;
}

/** The in-panel keys of HLD §4.12. */
export const ABOUT_PANEL_KEYS: ReadonlyArray<readonly [keys: string, action: string]> = [
  ['Escape', 'Close a menu, else the detail, else the panel'],
  ['↑ ↓ Home End PageUp PageDown', 'Move the selection in a list'],
  ['Enter', 'Open the detail of the selected row'],
  ['Ctrl+F', 'Focus the filter box'],
  ['Alt+1 / Alt+2', 'Network / Console'],
  ['← →', 'Move between tabs'],
  ['← → Enter Space', 'JSON tree: collapse / expand'],
];

/** `'ctrl+alt+shift+p'` → `'Ctrl+Alt+Shift+P'`; no chord → `'off'`. */
export function formatChord(spec: string | false | null | undefined): string {
  if (typeof spec !== 'string' || spec.trim() === '') return 'off';
  return spec
    .split('+')
    .map((part) => {
      const p = part.trim();
      return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    })
    .join('+');
}

/**
 * The About part at the end of the Settings popover: the package version and
 * every shortcut with the chord actually configured. Text only (`NFR-SEC-01`);
 * a focusable region, because it scrolls inside the popover.
 */
export function createAbout(dom: Dom, info: AboutInfo): HTMLElement {
  const capture = (key: keyof ShortcutConfig): string | false => info.capture?.[key] ?? false;
  const background: Array<readonly [string | false, string]> = [
    ...(info.activation === false
      ? []
      : [[info.activation, 'Turn the tool on (remembered); again: off for good'] as const]),
    [info.toggle, 'Open / close the panel'],
    [capture('download'), 'Download the capture (JSON file)'],
    [capture('copy'), 'Copy the capture (JSON) to the clipboard'],
    [capture('clear'), 'Clear the capture'],
    [capture('record'), 'Capture on / off'],
    [capture('note'), 'Add the pre-set note'],
  ];
  const row = (keys: string, action: string): HTMLTableRowElement =>
    dom.el('tr', null, [dom.el('td', null, [dom.el('kbd', null, [keys])]), dom.el('td', null, [action])]);
  return dom.el(
    'section',
    { className: 'dcp-about', attrs: { role: 'region', 'aria-label': 'About', tabindex: '0' } },
    [
      dom.el('h3', null, ['About']),
      dom.el('p', null, [`debug-capture ${info.version}`]),
      dom.el('table', null, [
        dom.el('tbody', null, [
          ...background.map(([chord, action]) => row(formatChord(chord), action)),
          ...ABOUT_PANEL_KEYS.map(([keys, action]) => row(keys, action)),
        ]),
      ]),
    ],
  );
}
