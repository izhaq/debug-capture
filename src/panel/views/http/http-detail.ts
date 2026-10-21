import {
  Child,
  createBadge,
  createButton,
  createIcon,
  createJsonViewer,
  createMenu,
  createTabs,
  describeBody,
  Dom,
  formatDuration,
  formatSize,
  formatTime,
  HeaderMap,
  HIGHLIGHT_MAX_MARKS,
  HttpRow,
  isPendingRow,
  isRedacted,
  JsonViewer,
  PanelState,
  redactedRanges,
  Selected,
  setAttr,
  setStyle,
  TimeFormat,
  toCurl,
  Truncation,
  UNKNOWN,
  ViewDeps,
} from '../../ui';
import { statusLabel } from './http-cells';

/** Characters of a body shown before "Show all" (FR-COM-02): one text node, but a 1 MB one is slow to lay out. */
export const BODY_PREVIEW_CHARS = 10_000;

const PANEL_ID = 'dcp-http-tabpanel';
const TABS = ['Headers', 'Payload', 'Response', 'Timing'];

export interface HttpDetail {
  readonly element: HTMLElement;
  /** Shows the selected request (`null` hides). Renders again only when what it shows changed. */
  show(selected: Selected<HttpRow> | null, state: PanelState, rows: readonly HttpRow[]): void;
  setTime(time: TimeFormat): void;
  /** Closes the Copy menu; `true` if it was open (Escape, §4.12). */
  closeMenu(): boolean;
  /** Moves focus to the sub-tabs (Enter on a row, §4.12). */
  focus(): void;
  destroy(): void;
}

/** The slowest finished request in view: the Timing bar's full width (§4.6). */
function slowestOf(rows: readonly HttpRow[]): number {
  let max = 0;
  for (const row of rows)
    if (!isPendingRow(row) && row.durationMs !== null && row.durationMs > max) max = row.durationMs;
  return max;
}

/** Header names are lower-case as captured (`HeaderMap`). */
function header(map: HeaderMap | undefined, name: string): string {
  return map?.[name] ?? '';
}

function cutNote(cut: Truncation): string {
  if (cut.kind === 'capped') return 'over 1 MB — full length unknown';
  return cut.originalLength === null ? 'full length unknown' : `original ${cut.originalLength} chars`;
}

/**
 * The HTTP detail (S05-07…12, §4.6): sub-tabs Headers / Payload / Response /
 * Timing, Copy ▾ and ✕. Built once per view; `show` swaps its content.
 */
export function createHttpDetail(dom: Dom, deps: ViewDeps, onClose: () => void): HttpDetail {
  const { report } = deps;
  let row: HttpRow | null = null;
  let tab = 'headers';
  let raw = false;
  let full = false;
  let time = deps.settings.time;
  let redacted = '';
  let rows: readonly HttpRow[] = [];
  let slowest = 0;
  let viewer: JsonViewer | null = null;

  const tabs = createTabs(dom, {
    tabs: TABS.map((label) => ({ id: label.toLowerCase(), label, panelId: PANEL_ID })),
    ariaLabel: 'Request detail',
    idPrefix: 'dcp-http-tab',
    onChange: (id) => {
      tab = id;
      raw = false;
      full = false;
      render();
    },
    onError: report,
  });
  const copyButton = createButton(dom, { label: 'Copy', icon: 'copy', onClick: () => undefined, onError: report });
  const menu = createMenu(dom, {
    trigger: copyButton.element,
    ariaLabel: 'Copy',
    items: [
      { id: 'url', label: 'Copy URL' },
      { id: 'request', label: 'Copy request body' },
      { id: 'response', label: 'Copy response body' },
      { id: 'curl', label: 'Copy as cURL' },
    ],
    onSelect: (id) => {
      if (row === null) return;
      const done = isPendingRow(row) ? null : row;
      const text =
        id === 'url'
          ? row.url
          : id === 'curl'
            ? toCurl(row, redacted)
            : ((id === 'request' ? done?.reqBody : done?.resBody) ?? '');
      // Only on this user action (NFR-SEC-04); the sink keeps its helper inside our shadow root (C-5).
      deps.source.copyText(text, deps.root).catch(report);
    },
    onError: report,
  });
  const close = createButton(dom, {
    label: 'Close detail',
    icon: 'close',
    iconOnly: true,
    onClick: onClose,
    onError: report,
  });
  const rawButton = createButton(dom, {
    label: 'Raw',
    onClick: () => {
      raw = !raw;
      render();
    },
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
  const removed = dom.el('p', { className: 'dcp-http-removed', attrs: { hidden: true } }, [
    'This entry was removed from the buffer.',
  ]);
  const body = dom.el('div', { className: 'dcp-detail-body dcp-http-body', attrs: { id: PANEL_ID, role: 'tabpanel' } });
  const element = dom.el('div', { className: 'dcp-detail dcp-http-detail', attrs: { hidden: true } }, [
    dom.el('div', { className: 'dcp-detail-header' }, [
      tabs.element,
      dom.el('span', { className: 'dcp-http-grow' }),
      menu.element,
      close.element,
    ]),
    removed,
    body,
  ]);

  /** `text` with each `[redacted]` in it marked like the badge, no icon (§5.7, FR-HTTP-07). */
  const marked = (text: string): DocumentFragment => {
    const fragment = deps.document.createDocumentFragment();
    let from = 0;
    for (const range of redactedRanges(text, redacted).slice(0, HIGHLIGHT_MAX_MARKS)) {
      dom.append(fragment, [
        text.slice(from, range.start) || null,
        dom.el('mark', { className: 'dcp-json-redacted' }, [text.slice(range.start, range.end)]),
      ]);
      from = range.end;
    }
    dom.append(fragment, [text.slice(from) || null]);
    return fragment;
  };
  const value = (text: string): Child => (isRedacted(text, redacted) ? createBadge(dom, 'redacted') : marked(text));
  const table = (pairs: readonly (readonly [string, Child])[]): HTMLElement =>
    dom.el('table', { className: 'dcp-http-kv dcp-data' }, [
      dom.el(
        'tbody',
        null,
        pairs.map(([name, cell]) =>
          dom.el('tr', null, [
            dom.el('th', { attrs: { dir: 'auto' } }, [name]),
            dom.el('td', { attrs: { dir: 'auto' } }, [cell]),
          ]),
        ),
      ),
    ]);
  const heading = (text: string): HTMLElement => dom.el('h3', { className: 'dcp-http-h' }, [text]);
  const note = (text: string): HTMLElement => dom.el('p', { className: 'dcp-http-note' }, [text]);
  const headers = (title: string, map: HeaderMap | undefined): Child[] => {
    const names = Object.keys(map ?? {});
    return [
      heading(`${title} (${names.length})`),
      names.length > 0 ? table(names.map((name) => [name, value(header(map, name))])) : note('None'),
    ];
  };
  const longText = (text: string): Child[] => {
    const cut = !full && text.length > BODY_PREVIEW_CHARS;
    if (cut) showAll.setLabel(`Show all (${text.length} chars)`);
    return [
      dom.el('pre', { className: 'dcp-http-pre dcp-data', attrs: { dir: 'auto' } }, [
        marked(cut ? text.slice(0, BODY_PREVIEW_CHARS) : text),
      ]),
      cut && showAll.element,
    ];
  };

  const renderHeaders = (r: HttpRow): Child[] => {
    const done = isPendingRow(r) ? null : r;
    return [
      heading('General'),
      table([
        ['URL', marked(r.url)],
        ['Method', r.method],
        ['Status', statusLabel(dom, r)],
        ['Transport', r.transport === 'xhr' ? 'XHR' : 'Fetch'],
        ['Start', formatTime(r.t, time)],
        ['Duration', formatDuration(done?.durationMs ?? null)],
        ['Size', formatSize(done?.bytes ?? null)],
      ]),
      ...headers('Request headers', r.reqHeaders),
      ...headers('Response headers', done?.resHeaders),
    ];
  };

  const renderBody = (r: HttpRow, request: boolean): Child[] => {
    if (isPendingRow(r)) return [note(request ? 'No request body' : 'The request is still pending.')];
    const text = request ? r.reqBody : r.resBody;
    const type = header(request ? r.reqHeaders : r.resHeaders, 'content-type');
    // A response arrived but the probe did not read it (binary, event stream — v1 stores `null`).
    if (!request && text === null && r.status !== null && r.error === null) {
      return [note(`Body not captured (${/event-stream/i.test(type) ? 'event stream' : 'binary'})`)];
    }
    const view = describeBody(text, { capped: !request && r.resBodyCapped === true, contentType: type });
    if (view.kind === 'empty') return [note(request ? 'No request body' : 'No response body')];
    const structured = view.kind === 'json' || view.kind === 'form';
    setAttr(rawButton.element, 'aria-pressed', raw ? 'true' : 'false');
    const tools: Child[] = [
      structured && rawButton.element,
      view.truncation && createBadge(dom, 'truncated'),
      view.truncation && dom.el('span', { className: 'dcp-meta' }, [cutNote(view.truncation)]),
    ];
    const out: Child[] = [tools.some(Boolean) && dom.el('div', { className: 'dcp-http-tools' }, tools)];
    if (view.kind === 'json' && !raw) {
      viewer = createJsonViewer(deps.document, view.value, {
        ariaLabel: request ? 'Request body' : 'Response body',
        redactedValue: redacted,
        badgeIcon: (kind) => createIcon(dom, kind),
        onError: report,
      });
      out.push(viewer.element);
    } else if (view.kind === 'form' && !raw) {
      out.push(table(view.fields.map((field) => [field.name, value(field.value)])));
    } else {
      out.push(...longText(view.text));
    }
    return out;
  };

  const renderTiming = (r: HttpRow): Child[] => {
    const ms = isPendingRow(r) ? null : r.durationMs;
    const fill = dom.el('div', { className: 'dcp-http-bar__fill' });
    setStyle(fill, 'width', `${ms !== null && slowest > 0 ? Math.min(100, (ms / slowest) * 100) : 0}%`);
    return [
      table([
        ['Start', formatTime(r.t, time)],
        ['End', ms === null ? UNKNOWN : formatTime(r.t + ms, time)],
        ['Duration', formatDuration(ms)],
      ]),
      dom.el(
        'div',
        {
          className: 'dcp-http-bar',
          attrs: { role: 'img', 'aria-label': `${formatDuration(ms)} of the slowest ${formatDuration(slowest)}` },
        },
        [fill],
      ),
    ];
  };

  const render = (): void => {
    viewer?.destroy();
    viewer = null;
    body.textContent = '';
    setAttr(body, 'aria-labelledby', tabs.tabElement(tab)?.id);
    if (row === null) return;
    if (tab === 'timing') slowest = slowestOf(rows);
    dom.append(
      body,
      tab === 'headers'
        ? renderHeaders(row)
        : tab === 'timing'
          ? renderTiming(row)
          : renderBody(row, tab === 'payload'),
    );
  };

  /** Body items need a finished request with a body. Toggled on the live items: the menu reads `disabled` each time. */
  const updateMenu = (): void => {
    const done = row === null || isPendingRow(row) ? null : row;
    for (const [id, text] of [
      ['request', done?.reqBody],
      ['response', done?.resBody],
    ] as const) {
      const item = menu.popup.querySelector<HTMLButtonElement>(`[data-item="${id}"]`);
      if (item) item.disabled = text === null || text === undefined;
    }
  };

  return {
    element,
    show(selected, state, next) {
      rows = next;
      element.hidden = selected === null;
      removed.hidden = selected?.removed !== true;
      let dirty = state.redactedValue !== redacted;
      redacted = state.redactedValue;
      const shown = selected?.row ?? null;
      if (shown !== row) {
        row = shown;
        raw = false;
        full = false;
        dirty = true;
        updateMenu();
        if (row === null) menu.close(false);
      }
      if (tab === 'timing' && slowestOf(rows) !== slowest) dirty = true;
      if (dirty) render();
    },
    setTime(next) {
      time = next;
      render();
    },
    closeMenu() {
      if (!menu.isOpen) return false;
      menu.close();
      return true;
    },
    focus: () => tabs.focus(),
    destroy() {
      viewer?.destroy();
      tabs.destroy();
      menu.destroy();
      copyButton.destroy();
      close.destroy();
      rawButton.destroy();
      showAll.destroy();
    },
  };
}
