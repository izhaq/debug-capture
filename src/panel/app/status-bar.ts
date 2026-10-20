import { createIcon, Dom, IconName } from '../views';

/** What the status bar shows (FR-BAR-06, HLD §4.9, §4.11). */
export interface StatusValues {
  /** `N / M shown` for the visible list. */
  readonly shown: number;
  readonly total: number;
  /** Problems in the whole buffer (`FR-ACT-04`). */
  readonly problems: number;
  readonly used: number;
  readonly capacity: number;
  readonly dropped: number;
  readonly evicted: number;
  readonly captureOn: boolean;
  /** Panel failures (`NFR-REL-01`); shown only above zero. */
  readonly errors: number;
}

export interface StatusBar {
  readonly element: HTMLElement;
  /** Writes only the parts whose text changed. */
  update(values: StatusValues): void;
}

/** `1284` → `1,284`, the same in every locale. */
export function groupDigits(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The status bar: plain text parts, each with its icon **and** its word
 * (`NFR-A11Y-01`: `capture ● on` / `capture ○ off`). No `aria-live`: the
 * counts change on every entry and would flood a screen reader.
 */
export function createStatusBar(dom: Dom): StatusBar {
  const text = (): Text => dom.text('');
  const shown = text();
  const problems = text();
  const buffer = text();
  const capture = text();
  const dropped = text();
  const evicted = text();
  const errors = text();
  const problemIcon = dom.el('span', { className: 'dcp-status__icon' });
  const captureIcon = dom.el('span', { className: 'dcp-status__icon' });
  const part = (...children: Node[]): HTMLElement => dom.el('span', { className: 'dcp-status__part' }, children);
  const errorPart = dom.el('span', { className: 'dcp-status__part dcp-tone-error', attrs: { hidden: true } }, [errors]);
  const element = dom.el('footer', { className: 'dcp-statusbar', attrs: { 'aria-label': 'Status' } }, [
    part(shown),
    part(problemIcon, problems),
    part(buffer),
    part(dom.text('capture '), captureIcon, capture),
    part(dropped),
    part(evicted),
    errorPart,
  ]);

  const write = (node: Text, value: string): void => {
    if (node.data !== value) node.data = value;
  };
  let problemTone: string | null = null;
  let captureState: boolean | null = null;
  const icon = (holder: HTMLElement, name: IconName, tone: string): void => {
    holder.className = `dcp-status__icon ${tone}`;
    holder.replaceChildren(createIcon(dom, name));
  };

  return {
    element,
    update(v): void {
      write(shown, `${groupDigits(v.shown)} / ${groupDigits(v.total)} shown`);
      const tone = v.problems > 0 ? 'dcp-tone-error' : 'dcp-tone-muted';
      if (tone !== problemTone) {
        problemTone = tone;
        icon(problemIcon, 'error', tone);
      }
      write(problems, ` ${groupDigits(v.problems)} problem${v.problems === 1 ? '' : 's'}`);
      write(buffer, `buffer ${groupDigits(v.used)} / ${groupDigits(v.capacity)}`);
      if (v.captureOn !== captureState) {
        captureState = v.captureOn;
        icon(captureIcon, v.captureOn ? 'opened' : 'off', v.captureOn ? 'dcp-tone-success' : 'dcp-tone-warning');
      }
      write(capture, v.captureOn ? ' on' : ' off');
      write(dropped, `dropped ${groupDigits(v.dropped)}`);
      write(evicted, `evicted ${groupDigits(v.evicted)}`);
      write(errors, `panel error ${groupDigits(v.errors)}`);
      const hideErrors = v.errors === 0;
      if (errorPart.hidden !== hideErrors) errorPart.hidden = hideErrors;
    },
  };
}
