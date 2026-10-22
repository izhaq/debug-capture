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
  formatSize,
  formatTime,
  JsonViewer,
  PanelState,
  Selected,
  selectWsConnections,
  setAttr,
  splitTruncation,
  TimeFormat,
  UNKNOWN,
  ViewDeps,
  WebSocketEntry,
  WsConnection,
  wsEventLabel,
} from '../../ui';
import { binaryText, stateLabel } from './ws-cells';

/** Characters of a frame shown before "Show all" (FR-COM-02): one text node, but a 1 MB one is slow to lay out. */
export const FRAME_PREVIEW_CHARS = 10_000;

/** Bytes of the hex view shown before "Show all": 256 lines of 16. */
export const HEX_PREVIEW_BYTES = 4_096;

const PANEL_ID = 'dcp-ws-tabpanel';

export interface WsDetail {
  readonly element: HTMLElement;
  /** Shows the selected message (`null` hides). Renders again only when what it shows changed. */
  show(selected: Selected<WebSocketEntry> | null, state: PanelState): void;
  setTime(time: TimeFormat): void;
  /** Closes the Copy menu; `true` if it was open (Escape, §4.12). */
  closeMenu(): boolean;
  /** Moves focus to the sub-tabs (Enter on a row, §4.12). */
  focus(): void;
  destroy(): void;
}

/**
 * v1 stores a binary frame as base64 and may cut it anywhere (`maxBodyLength`).
 * Only whole 4-character groups decode: a cut tail would give wrong bytes, so it
 * is dropped and the view says *cut* (FR-WS-04). `bytes` is a binary string.
 */
function decodeBase64(text: string): { readonly bytes: string; readonly cut: boolean } {
  const whole = text.length - (text.length % 4);
  try {
    return { bytes: atob(text.slice(0, whole)), cut: whole < text.length };
  } catch {
    // Not base64 (a broken or hostile entry): nothing decodes.
    return { bytes: '', cut: true };
  }
}

/** `00000010  41 42 …  AB`: the offset, up to 16 bytes, then the printable ASCII (others as `.`). */
function hexDump(bytes: string): string {
  const lines: string[] = [];
  for (let at = 0; at < bytes.length; at += 16) {
    let hex = '';
    let ascii = '';
    for (let i = at; i < Math.min(at + 16, bytes.length); i++) {
      const code = bytes.charCodeAt(i);
      hex += `${code < 16 ? '0' : ''}${code.toString(16)} `;
      ascii += code > 31 && code < 127 ? bytes.charAt(i) : '.';
    }
    lines.push(`${at.toString(16).padStart(8, '0')}  ${hex.padEnd(48)} ${ascii}`);
  }
  return lines.join('\n');
}

/**
 * The message detail (S06-06…08, S06-11, §4.7): sub-tabs Message / Info,
 * Copy ▾ and ✕. Built once per view; `show` swaps its content.
 */
export function createWsDetail(dom: Dom, deps: ViewDeps, onClose: () => void): WsDetail {
  const { report } = deps;
  let row: WebSocketEntry | null = null;
  let conn: WsConnection | undefined;
  let tab = 'message';
  let raw = false;
  let full = false;
  let time = deps.settings.time;
  let redacted = '';
  let viewer: JsonViewer | null = null;

  const tabs = createTabs(dom, {
    tabs: ['Message', 'Info'].map((label) => ({ id: label.toLowerCase(), label, panelId: PANEL_ID })),
    ariaLabel: 'Message detail',
    idPrefix: 'dcp-ws-tab',
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
      { id: 'message', label: 'Copy message' },
      { id: 'url', label: 'Copy URL' },
    ],
    onSelect: (id) => {
      if (row === null) return;
      // The data as stored (D-26), only on this user action (NFR-SEC-04); the sink stays inside our shadow root (C-5).
      deps.source.copyText((id === 'url' ? row.url : row.data) ?? '', deps.root).catch(report);
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
  const removed = dom.el('p', { className: 'dcp-ws-removed', attrs: { hidden: true } }, [
    'This entry was removed from the buffer.',
  ]);
  const body = dom.el('div', { className: 'dcp-detail-body dcp-ws-body', attrs: { id: PANEL_ID, role: 'tabpanel' } });
  const element = dom.el('div', { className: 'dcp-detail dcp-ws-detail', attrs: { hidden: true } }, [
    dom.el('div', { className: 'dcp-detail-header' }, [
      tabs.element,
      dom.el('span', { className: 'dcp-ws-grow' }),
      menu.element,
      close.element,
    ]),
    removed,
    body,
  ]);

  const heading = (text: string): HTMLElement => dom.el('h3', { className: 'dcp-ws-h' }, [text]);
  const note = (text: string): HTMLElement => dom.el('p', { className: 'dcp-ws-note' }, [text]);
  const meta = (text: string): HTMLElement => dom.el('span', { className: 'dcp-meta' }, [text]);
  const pre = (text: string, className = ''): HTMLElement =>
    dom.el('pre', { className: `dcp-ws-pre dcp-data ${className}`, attrs: { dir: 'auto' } }, [text]);
  const tools = (items: readonly Child[]): Child =>
    items.some(Boolean) && dom.el('div', { className: 'dcp-ws-tools' }, items);
  const table = (pairs: readonly (readonly [string, Child])[]): HTMLElement =>
    dom.el('table', { className: 'dcp-ws-kv dcp-data' }, [
      dom.el(
        'tbody',
        null,
        pairs.map(([name, cell]) =>
          dom.el('tr', null, [dom.el('th', null, [name]), dom.el('td', { attrs: { dir: 'auto' } }, [cell])]),
        ),
      ),
    ]);
  const at = (t: number | null | undefined): string => (typeof t === 'number' ? formatTime(t, time) : UNKNOWN);

  /** Text frames as-is; JSON as the tree with Raw (FR-WS-04). */
  const renderText = (data: string | null): Child[] => {
    const view = describeBody(data);
    if (view.kind === 'empty') return [note('Empty message')];
    const cut = view.truncation;
    setAttr(rawButton.element, 'aria-pressed', raw ? 'true' : 'false');
    const out: Child[] = [
      tools([
        view.kind === 'json' && rawButton.element,
        cut && createBadge(dom, 'truncated'),
        cut && meta(`original ${cut.originalLength ?? UNKNOWN} chars`),
      ]),
    ];
    if (view.kind === 'json' && !raw) {
      viewer = createJsonViewer(deps.document, view.value, {
        ariaLabel: 'Message',
        redactedValue: redacted,
        badgeIcon: (kind) => createIcon(dom, kind),
        onError: report,
      });
      return [...out, viewer.element];
    }
    const long = !full && view.text.length > FRAME_PREVIEW_CHARS;
    if (long) showAll.setLabel(`Show all (${view.text.length} chars)`);
    return [...out, pre(long ? view.text.slice(0, FRAME_PREVIEW_CHARS) : view.text), long && showAll.element];
  };

  /** Binary frames as stored (base64) and as bytes (hex); a cut ends in `…` (FR-WS-04). */
  const renderBinary = (e: WebSocketEntry): Child[] => {
    if (e.data === null) return [note(binaryText(e))];
    const split = splitTruncation(e.data);
    const decoded = decodeBase64(split.text);
    const bytes = decoded.bytes;
    const cut = decoded.cut || split.truncation !== null;
    const end = cut ? '…' : '';
    const long = !full && (split.text.length > FRAME_PREVIEW_CHARS || bytes.length > HEX_PREVIEW_BYTES);
    if (long) showAll.setLabel(`Show all (${bytes.length} bytes)`);
    return [
      tools([
        cut && createBadge(dom, 'truncated', 'cut'),
        cut && meta(`${bytes.length} of ${e.bytes ?? UNKNOWN} bytes`),
      ]),
      heading('Base64'),
      pre((long ? split.text.slice(0, FRAME_PREVIEW_CHARS) : split.text) + end),
      heading('Hex'),
      pre([hexDump(long ? bytes.slice(0, HEX_PREVIEW_BYTES) : bytes), end].filter(Boolean).join('\n'), 'dcp-ws-hex'),
      long && showAll.element,
    ];
  };

  const renderMessage = (e: WebSocketEntry): Child[] => {
    // Only our words in this line; the close reason (captured text) goes in its own cell.
    const kind = e.opcode === null ? null : e.opcode === 'text' ? 'Text' : 'Binary';
    const word = wsEventLabel(e).text.split(' ', 1)[0];
    const size = e.bytes === null ? null : formatSize(e.bytes);
    const out: Child[] = [
      dom.el('p', { className: 'dcp-meta dcp-ws-p' }, [
        [kind, word, formatTime(e.t, time), size].filter(Boolean).join(' · '),
      ]),
    ];
    if (e.opcode === 'text') return [...out, ...renderText(e.data)];
    if (e.opcode === 'binary') return [...out, ...renderBinary(e)];
    if (e.event === 'close')
      out.push(
        table([
          ['Code', e.code ?? UNKNOWN],
          ['Reason', e.data || UNKNOWN],
        ]),
      );
    if (e.event === 'error') out.push(note('The browser gives no details about WebSocket errors.'));
    return out;
  };

  /** The connection as the buffer knows it now; once it left the buffer, what the entry itself knows (S06-07). */
  const renderInfo = (e: WebSocketEntry): Child[] => {
    const c = conn;
    return [
      table([
        ['URL', e.url],
        ['Socket id', `#${e.socketId}`],
        ['State', c ? stateLabel(dom, c.state) : UNKNOWN],
        ['Opened', at(c?.openedAt)],
        ['Closed', at(c?.closedAt)],
        ['Close code', c?.closeCode ?? UNKNOWN],
        ['Close reason', c?.closeReason || UNKNOWN],
        [
          'Messages',
          c
            ? dom.el('span', null, [
                createIcon(dom, 'sent'),
                ` ${c.sent} sent · `,
                createIcon(dom, 'received'),
                ` ${c.received} received`,
              ])
            : UNKNOWN,
        ],
      ]),
    ];
  };

  const render = (): void => {
    viewer?.destroy();
    viewer = null;
    body.textContent = '';
    setAttr(body, 'aria-labelledby', tabs.tabElement(tab)?.id);
    if (row !== null) dom.append(body, tab === 'info' ? renderInfo(row) : renderMessage(row));
  };

  /** Toggled on the live item: the menu reads `disabled` each time. */
  const updateMenu = (): void => {
    const item = menu.popup.querySelector<HTMLButtonElement>('[data-item="message"]');
    if (item) item.disabled = !row?.data;
  };

  return {
    element,
    show(selected, state) {
      element.hidden = selected === null;
      removed.hidden = selected?.removed !== true;
      const shown = selected?.row ?? null;
      const next = shown === null ? undefined : selectWsConnections(state).find((c) => c.socketId === shown.socketId);
      // Info follows its connection live (counts, close); the Message tab does not need to.
      let dirty = state.redactedValue !== redacted || (tab === 'info' && next !== conn);
      redacted = state.redactedValue;
      conn = next;
      if (shown !== row) {
        row = shown;
        raw = false;
        full = false;
        dirty = true;
        updateMenu();
        if (row === null) menu.close(false);
      }
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
