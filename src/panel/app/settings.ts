import type { HttpStatusGroup, ListId, LogLevel, PanelFilters, TextSize, WsDirection } from '../views';

export type ThemeSetting = 'auto' | 'dark' | 'light';
export type Dock = 'bottom' | 'right';
export type TimeSetting = 'clock' | 'relative';

/** The chip choices kept per list (HLD §4.10). Never the search text: it may hold a pasted secret (§6.8). */
export interface StoredChips {
  readonly http: { readonly status: readonly HttpStatusGroup[]; readonly type: readonly ('xhr' | 'fetch')[] };
  readonly ws: { readonly direction: readonly WsDirection[]; readonly data: readonly ('text' | 'binary')[] };
  readonly console: { readonly levels: readonly LogLevel[] };
}

/**
 * What the panel remembers per browser (`FR-ACT-08`, `D-20`). Capture on/off
 * is not here on purpose: every reload starts with capture on (`FR-ACT-09`).
 */
export interface PanelSettings {
  readonly theme: ThemeSetting;
  readonly dock: Dock;
  readonly textSize: TextSize;
  readonly time: TimeSetting;
  /** Panel height docked bottom, px; `null` = the 40 % default (§5.3). */
  readonly height: number | null;
  /** Panel width docked right, px; `null` = the 520 px default (§5.3). */
  readonly width: number | null;
  /** The last tab shown. */
  readonly tab: ListId;
  readonly chips: StoredChips;
}

const THEMES: readonly ThemeSetting[] = ['auto', 'dark', 'light'];
const DOCKS: readonly Dock[] = ['bottom', 'right'];
const TEXT_SIZES: readonly TextSize[] = ['small', 'normal', 'large'];
const TIMES: readonly TimeSetting[] = ['clock', 'relative'];
const TABS: readonly ListId[] = ['http', 'ws', 'console'];
const STATUS: readonly HttpStatusGroup[] = ['2xx', '3xx', '4xx', '5xx', 'failed', 'pending'];
const TYPES: readonly ('xhr' | 'fetch')[] = ['xhr', 'fetch'];
const DIRECTIONS: readonly WsDirection[] = ['sent', 'received'];
const DATA: readonly ('text' | 'binary')[] = ['text', 'binary'];
const LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'log', 'debug'];

export const NO_CHIPS: StoredChips = {
  http: { status: [], type: [] },
  ws: { direction: [], data: [] },
  console: { levels: [] },
};

export function defaultSettings(dock: Dock): PanelSettings {
  return {
    theme: 'auto',
    dock: DOCKS.indexOf(dock) >= 0 ? dock : 'bottom',
    textSize: 'normal',
    time: 'clock',
    height: null,
    width: null,
    tab: 'http',
    chips: NO_CHIPS,
  };
}

/** The chips of the store's filters, without the search text. */
export function chipsOf(filters: PanelFilters): StoredChips {
  return {
    http: { status: filters.http.status, type: filters.http.type },
    ws: { direction: filters.ws.direction, data: filters.ws.data },
    console: { levels: filters.console.levels },
  };
}

/** A parsed object with only the keys `K` read, each still unknown. */
type Raw<K extends string> = Partial<Record<K, unknown>>;

const record = <K extends string>(value: unknown): Raw<K> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw<K>) : {};
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.indexOf(value as T) >= 0 ? (value as T) : fallback;
/** Known values only, in a fixed order, each once. */
const someOf = <T extends string>(value: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(value) ? allowed.filter((item) => value.indexOf(item) >= 0) : [];
const px = (value: unknown): number | null =>
  typeof value === 'number' && isFinite(value) && value >= 1 && value <= 100000 ? Math.round(value) : null;

/** Reads a stored value; anything unknown, missing or of the wrong type falls back to `defaults`. */
export function parseSettings(text: string | null, defaults: PanelSettings): PanelSettings {
  if (text === null) return defaults;
  let raw: Raw<'theme' | 'dock' | 'textSize' | 'time' | 'height' | 'width' | 'tab' | 'chips'>;
  try {
    raw = record(JSON.parse(text));
  } catch {
    return defaults;
  }
  const chips = record<'http' | 'ws' | 'console'>(raw.chips);
  const http = record<'status' | 'type'>(chips.http);
  const ws = record<'direction' | 'data'>(chips.ws);
  const con = record<'levels'>(chips.console);
  return {
    theme: oneOf(raw.theme, THEMES, defaults.theme),
    dock: oneOf(raw.dock, DOCKS, defaults.dock),
    textSize: oneOf(raw.textSize, TEXT_SIZES, defaults.textSize),
    time: oneOf(raw.time, TIMES, defaults.time),
    height: px(raw.height),
    width: px(raw.width),
    tab: oneOf(raw.tab, TABS, defaults.tab),
    chips: {
      http: { status: someOf(http.status, STATUS), type: someOf(http.type, TYPES) },
      ws: { direction: someOf(ws.direction, DIRECTIONS), data: someOf(ws.data, DATA) },
      console: { levels: someOf(con.levels, LEVELS) },
    },
  };
}

/** The stored text: the fields above and nothing else, so no other value can ever reach storage. */
export function serializeSettings(s: PanelSettings): string {
  return JSON.stringify({
    v: 1,
    theme: s.theme,
    dock: s.dock,
    textSize: s.textSize,
    time: s.time,
    height: s.height,
    width: s.width,
    tab: s.tab,
    chips: chipsOf({
      http: { text: '', ...s.chips.http },
      ws: { text: '', ...s.chips.ws },
      console: { text: '', ...s.chips.console },
    }),
  });
}

/** The two `Storage` calls the panel makes. */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface SettingsStore {
  load(): PanelSettings;
  /** Writes only when the stored text changes. Never throws. */
  save(settings: PanelSettings): void;
}

/**
 * `localStorage[key]`, best effort (HLD §4.10, §6.8): `storage` is a getter
 * because reading `window.localStorage` itself throws when storage is
 * blocked. Every read and write is in `try/catch`; blocked or corrupt storage
 * gives the defaults, and the panel works the same. `key: false` stores
 * nothing and reads nothing.
 */
export function createSettingsStore(
  storage: () => SettingsStorage | null,
  key: string | false,
  defaults: PanelSettings,
): SettingsStore {
  let last: string | null = null;
  return {
    load(): PanelSettings {
      if (key === false) return defaults;
      try {
        last = storage()?.getItem(key) ?? null;
      } catch {
        last = null;
      }
      return parseSettings(last, defaults);
    },
    save(settings): void {
      if (key === false) return;
      const text = serializeSettings(settings);
      if (text === last) return;
      try {
        storage()?.setItem(key, text);
        last = text;
      } catch {
        // Full or blocked: the settings simply are not kept.
      }
    },
  };
}
