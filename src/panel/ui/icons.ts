import { Attrs, Dom } from './dom';

/**
 * Inline SVG icons (S04-03, HLD §5.1, §5.3, §5.6): 14 px, drawn in
 * `currentColor` so the text colour of the cell or button decides the colour.
 * SVG, not emoji or font glyphs, so they look the same on every OS and need
 * no web font (ISO-05). Shapes follow `docs/design/mockup.html`.
 */
export type IconName =
  /** ✓ 2xx */
  | 'success'
  /** ↪ 3xx */
  | 'redirect'
  /** ⚠ 4xx, warn level */
  | 'warning'
  /** ✕ 5xx, failed, error level, socket error */
  | 'error'
  /** ◌ in flight, `pending` badge */
  | 'pending'
  /** ℹ info level */
  | 'info'
  /** • log level */
  | 'log'
  /** ⋯ debug level */
  | 'debug'
  /** ↑ WS sent */
  | 'sent'
  /** ↓ WS received */
  | 'received'
  /** ● WS opened, capture on */
  | 'opened'
  /** ■ WS closed */
  | 'closed'
  /** ○ capture off, closed connection */
  | 'off'
  /** 🔒 `redacted` badge */
  | 'redacted'
  /** ✂ `truncated` badge */
  | 'truncated'
  /** ⏸ */
  | 'pause'
  /** ▶ resume */
  | 'resume'
  /** ⟲ clear */
  | 'clear'
  /** ⇩ export */
  | 'export'
  /** ⚙ settings */
  | 'settings'
  /** ⤢ maximize */
  | 'maximize'
  /** ✕ close */
  | 'close'
  | 'search'
  | 'copy'
  /** ◉ the panel's mark */
  | 'brand'
  /** ↓ "N new" follow button */
  | 'new'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'chevron-right';

type Shape = readonly ['path' | 'circle' | 'rect', Attrs];

/** Filled parts: no stroke. */
const FILL: Attrs = { fill: 'currentColor', stroke: 'none' };

const CROSS: readonly Shape[] = [['path', { d: 'M4 4l8 8M12 4l-8 8', 'stroke-width': 1.6 }]];
const DOWN: readonly Shape[] = [['path', { d: 'M8 3v10M4 9l4 4 4-4', 'stroke-width': 1.6 }]];
const RING: readonly Shape[] = [['circle', { cx: 8, cy: 8, r: 5.5, 'stroke-dasharray': '2 2.3' }]];

const SHAPES: Readonly<Record<IconName, readonly Shape[]>> = {
  success: [['path', { d: 'M3 8.5l3 3 7-7', 'stroke-width': 1.6 }]],
  redirect: [['path', { d: 'M3 3v4a3 3 0 0 0 3 3h7M10 7l3 3-3 3' }]],
  warning: [['path', { d: 'M8 2L1.5 13.5h13zM8 6.5v3.2M8 11.6v.2' }]],
  error: CROSS,
  pending: RING,
  info: [
    ['circle', { cx: 8, cy: 8, r: 6, 'stroke-width': 1.4 }],
    ['path', { d: 'M8 7.3v4M8 4.8v.2', 'stroke-width': 1.6 }],
  ],
  log: [['circle', { cx: 8, cy: 8, r: 2.5, ...FILL }]],
  debug: [
    ['circle', { cx: 3.5, cy: 8, r: 1.3, ...FILL }],
    ['circle', { cx: 8, cy: 8, r: 1.3, ...FILL }],
    ['circle', { cx: 12.5, cy: 8, r: 1.3, ...FILL }],
  ],
  sent: [['path', { d: 'M8 13V3M4 7l4-4 4 4', 'stroke-width': 1.6 }]],
  received: DOWN,
  opened: [['circle', { cx: 8, cy: 8, r: 4.5, ...FILL }]],
  closed: [['rect', { x: 4, y: 4, width: 8, height: 8, rx: 1, ...FILL }]],
  off: [['circle', { cx: 8, cy: 8, r: 4.5 }]],
  redacted: [
    ['rect', { x: 3.5, y: 7, width: 9, height: 7, rx: 1.2 }],
    ['path', { d: 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' }],
  ],
  truncated: [
    ['circle', { cx: 4.5, cy: 11.5, r: 2, 'stroke-width': 1.4 }],
    ['circle', { cx: 11.5, cy: 11.5, r: 2, 'stroke-width': 1.4 }],
    ['path', { d: 'M5.8 10L12 2.5M10.2 10L4 2.5', 'stroke-width': 1.4 }],
  ],
  pause: [['path', { d: 'M5.5 3.5v9M10.5 3.5v9', 'stroke-width': 2 }]],
  resume: [['path', { d: 'M5 3.5l7 4.5-7 4.5z', ...FILL }]],
  clear: [['path', { d: 'M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.5v3h3' }]],
  export: [['path', { d: 'M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10' }]],
  settings: [
    ['circle', { cx: 8, cy: 8, r: 2.2, 'stroke-width': 1.4 }],
    ['circle', { cx: 8, cy: 8, r: 4.6, 'stroke-width': 1.4 }],
    [
      'path',
      {
        d: 'M8 1.5v1.9M8 12.6v1.9M1.5 8h1.9M12.6 8h1.9M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3',
        'stroke-width': 1.4,
      },
    ],
  ],
  maximize: [['path', { d: 'M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9' }]],
  close: CROSS,
  search: [
    ['circle', { cx: 7, cy: 7, r: 4.5 }],
    ['path', { d: 'M10.5 10.5L14 14' }],
  ],
  copy: [
    ['rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1, 'stroke-width': 1.4 }],
    ['path', { d: 'M3 10.5V3.5a1 1 0 0 1 1-1h6.5', 'stroke-width': 1.4 }],
  ],
  brand: [
    ['circle', { cx: 8, cy: 8, r: 6 }],
    ['circle', { cx: 8, cy: 8, r: 3, ...FILL }],
  ],
  new: DOWN,
  'chevron-down': [['path', { d: 'M4 6l4 4 4-4', 'stroke-width': 1.6 }]],
  'chevron-up': [['path', { d: 'M4 10l4-4 4 4', 'stroke-width': 1.6 }]],
  'chevron-left': [['path', { d: 'M10 4l-4 4 4 4', 'stroke-width': 1.6 }]],
  'chevron-right': [['path', { d: 'M6 4l4 4-4 4', 'stroke-width': 1.6 }]],
};

/** Every icon name, in a stable order (for tests and pickers). */
export const ICON_NAMES: readonly IconName[] = Object.keys(SHAPES) as IconName[];

/** Options for `createIcon`. */
export interface IconOptions {
  /**
   * Makes the icon meaningful (`role="img"` with this label). Without it the
   * icon is decorative and hidden from assistive tech, because the word next
   * to it already says the same (HLD §5.1).
   */
  readonly label?: string;
  /** Square size in px; default 14 (HLD §5.3). */
  readonly size?: number;
}

/** A new `<svg class="dcp-icon">` for `name`. */
export function createIcon(dom: Dom, name: IconName, options: IconOptions = {}): SVGSVGElement {
  const shapes = SHAPES[name];
  if (!shapes) throw new RangeError(`Unknown icon "${String(name)}"`);
  const size = options.size ?? 14;
  const labelled = options.label !== undefined;
  return dom.svg(
    'svg',
    {
      class: 'dcp-icon',
      'data-icon': name,
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      focusable: 'false',
      'aria-hidden': labelled ? null : 'true',
      role: labelled ? 'img' : null,
      'aria-label': labelled ? options.label : null,
    },
    shapes.map(([tag, attrs]) => dom.svg(tag, attrs)),
  );
}
