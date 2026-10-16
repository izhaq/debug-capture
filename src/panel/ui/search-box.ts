import { createListeners, Dom, ErrorReporter, report } from './dom';
import { createIcon } from './icons';

/**
 * Runs `task` after `delayMs` and returns a cancel function. Injected so P2
 * holds no global timer (AGENTS rule 8): S-08's scheduler passes the real one
 * (inside the root zone, ISO-09); specs pass a fake.
 */
export type Schedule = (task: () => void, delayMs: number) => () => void;

/** The pause after typing before a search applies (HLD §4.5). */
export const SEARCH_DEBOUNCE_MS = 150;

/** Options for `createSearchBox`. */
export interface SearchBoxOptions {
  /** Names the input, e.g. "Filter requests". */
  readonly ariaLabel: string;
  /** E.g. "Filter URL, method, status". */
  readonly placeholder?: string;
  readonly value?: string;
  readonly schedule: Schedule;
  /** Default `SEARCH_DEBOUNCE_MS`. */
  readonly delayMs?: number;
  /** The text to apply; called once typing pauses, or at once on Enter. Only when it changed. */
  readonly onSearch: (text: string) => void;
  readonly onError?: ErrorReporter;
}

/** A search box built by `createSearchBox`. */
export interface SearchBoxControl {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly value: string;
  /** Sets the text and drops a pending search, without calling `onSearch` (e.g. "Clear filters"). */
  setValue(text: string): void;
  focus(): void;
  /** Applies a pending search now. */
  flush(): void;
  /** Removes the listeners and cancels a pending search. */
  destroy(): void;
}

/**
 * The filter box (HLD §4.5): searches as you type, after a 150 ms pause.
 * The text is never stored (§6.8); `type="text"` (not `search`) so the
 * browser's own Escape-to-clear does not fight the panel's Escape (§4.12).
 */
export function createSearchBox(dom: Dom, options: SearchBoxOptions): SearchBoxControl {
  const input = dom.el('input', {
    className: 'dcp-search__input',
    attrs: {
      type: 'text',
      'aria-label': options.ariaLabel,
      placeholder: options.placeholder,
      autocomplete: 'off',
      spellcheck: 'false',
    },
  });
  input.value = options.value ?? '';
  const element = dom.el('div', { className: 'dcp-search', attrs: { role: 'search' } }, [
    createIcon(dom, 'search'),
    input,
  ]);
  let applied = input.value;
  let cancel: (() => void) | null = null;

  const drop = (): void => {
    const c = cancel;
    cancel = null;
    if (c) {
      try {
        c();
      } catch (error) {
        report(options.onError, error);
      }
    }
  };
  const apply = (): void => {
    drop();
    if (input.value === applied) return;
    applied = input.value;
    options.onSearch(applied);
  };
  const applySafely = (): void => {
    try {
      apply();
    } catch (error) {
      report(options.onError, error);
    }
  };

  const listeners = createListeners(options.onError);
  listeners.on(input, 'input', () => {
    drop();
    cancel = options.schedule(() => {
      cancel = null;
      applySafely();
    }, options.delayMs ?? SEARCH_DEBOUNCE_MS);
  });
  listeners.on(input, 'keydown', (event) => {
    if (event.key === 'Enter') apply();
  });

  return {
    element,
    input,
    get value() {
      return input.value;
    },
    setValue: (text) => {
      drop();
      input.value = text;
      applied = text;
    },
    focus: () => input.focus(),
    flush: applySafely,
    destroy: () => {
      drop();
      listeners.removeAll();
    },
  };
}
