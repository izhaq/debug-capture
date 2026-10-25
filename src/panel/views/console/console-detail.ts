import {
  Child,
  ConsoleRow,
  consoleText,
  createButton,
  createIcon,
  createJsonViewer,
  Dom,
  formatTime,
  JsonViewer,
  PanelState,
  Selected,
  setAttr,
  TimeFormat,
  ViewDeps,
} from '../../ui';
import { levelLabel } from './console-cells';

/** Characters of a message shown before "Show all" (as S05-14): one text node, but a long one is slow to lay out. */
export const MESSAGE_PREVIEW_CHARS = 10_000;
/** Argument trees shown, so the detail stays under 2,000 elements (`D-22`); the message above holds every argument. */
export const MAX_ARG_TREES = 20;
/** Tree items the argument trees open at start, shared between them: small values open fully, large ones stay closed. */
const OPEN_ITEMS = 200;
const STACK_ID = 'dcp-console-stack';

export interface ConsoleDetail {
  readonly element: HTMLElement;
  /** Shows the selected entry (`null` hides). Renders again only when what it shows changed. */
  show(selected: Selected<ConsoleRow> | null, state: PanelState): void;
  setTime(time: TimeFormat): void;
  /** Moves focus into the detail (Enter on a row, 4.12). */
  focus(): void;
  destroy(): void;
}

/**
 * The Console detail (S07-03, S07-07, 4.8): one page, no sub-tabs. The header
 * holds the level, time, error source and close; the body the full message,
 * then each argument as its own JSON tree (`D-04`), or an error's stack,
 * collapsed (React's component stack is part of it, as v1 stores it).
 * Built once per view; `show` swaps its content.
 */
export function createConsoleDetail(dom: Dom, deps: ViewDeps, onClose: () => void): ConsoleDetail {
  const { report } = deps;
  let row: ConsoleRow | null = null;
  let time = deps.settings.time;
  let redacted = '';
  let full = false;
  let viewers: JsonViewer[] = [];

  const close = createButton(dom, {
    label: 'Close detail',
    icon: 'close',
    iconOnly: true,
    onClick: onClose,
    onError: report,
  });
  const showAll = createButton(dom, {
    label: 'Show all',
    onClick: () => {
      full = true;
      render();
    },
    onError: report,
  });
  const stack = dom.el('pre', { className: 'dcp-console-pre dcp-data', attrs: { id: STACK_ID, dir: 'auto' } });
  const stackButton = createButton(dom, {
    label: 'Stack',
    icon: 'chevron-right',
    className: 'dcp-console-stack',
    onClick: () => openStack(stack.hidden),
    onError: report,
  });
  setAttr(stackButton.element, 'aria-controls', STACK_ID);
  const openStack = (open: boolean): void => {
    stack.hidden = !open;
    setAttr(stackButton.element, 'aria-expanded', String(open));
  };
  const when = dom.el('span', { className: 'dcp-meta' });
  const info = dom.el('div', { className: 'dcp-console-info' });
  const removed = dom.el('p', { className: 'dcp-console-removed', attrs: { hidden: true } }, [
    'This entry was removed from the buffer.',
  ]);
  // Focusable, so the keyboard can scroll a long message or stack (4.12).
  const body = dom.el('div', { className: 'dcp-detail-body dcp-console-body', attrs: { tabindex: 0 } });
  const element = dom.el(
    'section',
    { className: 'dcp-detail dcp-console-detail', attrs: { hidden: true, 'aria-label': 'Message detail' } },
    [dom.el('div', { className: 'dcp-detail-header' }, [info, close.element]), removed, body],
  );
  const heading = (text: string): HTMLElement => dom.el('h3', { className: 'dcp-console-h' }, [text]);

  const content = (r: ConsoleRow): Child[] => {
    const text = r.kind === 'note' ? r.text : consoleText(r);
    const cut = !full && text.length > MESSAGE_PREVIEW_CHARS;
    if (cut) showAll.setLabel(`Show all (${text.length} chars)`);
    const pre = (value: string): HTMLElement =>
      dom.el('pre', { className: 'dcp-console-pre dcp-data', attrs: { dir: 'auto' } }, [value]);
    const shown = cut ? text.slice(0, MESSAGE_PREVIEW_CHARS) : text;
    // A note (FR-NOTE-02): its title, then its whole text.
    if (r.kind === 'note') {
      return [
        heading('Note'),
        pre(r.title),
        text !== '' && heading('Text'),
        text !== '' && pre(shown),
        cut && showAll.element,
      ];
    }
    const out: Child[] = [heading('Message'), pre(shown), cut && showAll.element];
    if (r.kind === 'error') {
      if (r.stack !== null) {
        stack.textContent = r.stack;
        out.push(stackButton.element, stack);
      }
      return out;
    }
    viewers = r.args.slice(0, MAX_ARG_TREES).map((arg, i) =>
      createJsonViewer(deps.document, arg, {
        ariaLabel: `Argument ${i + 1}`,
        redactedValue: redacted,
        expandDepth: 0,
        badgeIcon: (kind) => createIcon(dom, kind),
        onError: report,
      }),
    );
    for (const viewer of viewers) viewer.expandAll(Math.floor(OPEN_ITEMS / viewers.length));
    out.push(heading(`Arguments (${r.args.length})`), ...viewers.map((viewer) => viewer.element));
    return out;
  };

  const render = (): void => {
    for (const viewer of viewers) viewer.destroy();
    viewers = [];
    info.textContent = '';
    body.textContent = '';
    if (row === null) return;
    try {
      when.textContent = formatTime(row.t, time);
      dom.append(info, [
        levelLabel(dom, row),
        when,
        row.kind === 'error' && dom.el('span', { className: 'dcp-tone-muted' }, [row.source]),
      ]);
      dom.append(body, content(row));
    } catch (error) {
      // A value the detail cannot show: counted in the status bar, never thrown at the host (ISO-12).
      report(error);
    }
  };

  return {
    element,
    show(selected, state) {
      element.hidden = selected === null;
      removed.hidden = selected?.removed !== true;
      let dirty = state.redactedValue !== redacted;
      redacted = state.redactedValue;
      const shown = selected?.row ?? null;
      if (shown !== row) {
        row = shown;
        full = false;
        openStack(false);
        dirty = true;
      }
      if (dirty) render();
    },
    setTime(next) {
      time = next;
      if (row !== null) when.textContent = formatTime(row.t, time);
    },
    focus: () => body.focus(),
    destroy() {
      for (const viewer of viewers) viewer.destroy();
      close.destroy();
      showAll.destroy();
      stackButton.destroy();
    },
  };
}
