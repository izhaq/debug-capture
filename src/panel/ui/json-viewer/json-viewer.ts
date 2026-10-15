import { JsonValue } from '../../model';
import { classifyJsonString, group, isPlaceholderKey } from './json-text';

/** The badges the viewer draws; the caller may give each an icon (HLD §5.4: 🔒, ✂). */
export type JsonBadgeKind = 'redacted' | 'truncated';

export interface JsonViewerOptions {
  /** The tree's accessible name (`aria-label`). */
  readonly ariaLabel: string;
  /** The policy's `redactedValue` (`C-3`): a leaf equal to it gets the `redacted` badge. */
  readonly redactedValue: string;
  /** Levels open at start; 0 shows the root collapsed. Default 1. */
  readonly expandDepth?: number;
  /** Children shown per object or array, and per "Show more". Default 100 (FR-COM-02). */
  readonly pageSize?: number;
  /** Characters of a string shown before "Show all". Default 1,000. */
  readonly longStringLimit?: number;
  /**
   * Draws a badge's icon. Injected because the icons live in a sibling P2
   * block this one may not import; without it the badge is text only.
   */
  readonly badgeIcon?: (kind: JsonBadgeKind) => Node | null;
}

export interface JsonViewer {
  /** The `role="tree"` list. The caller places it; `destroy()` removes it. */
  readonly element: HTMLElement;
  /**
   * Opens closed objects and arrays breadth first while the tree holds at
   * most `maxNodes` items; each still shows only its first page. Returns
   * `true` when nothing shown is left closed.
   */
  expandAll(maxNodes: number): boolean;
  /** Closes everything, the root included. */
  collapseAll(): void;
  /** Removes the listeners and the element. Safe to call twice. */
  destroy(): void;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_LONG_STRING = 1000;
/**
 * Items `expandDepth` may open at start. A wide value opened several levels
 * deep would otherwise render thousands of items before anyone asked.
 */
const INITIAL_ITEMS = 1000;
/** Characters of a collapsed node's one-line preview. */
const PREVIEW_CHARS = 60;
/** Inline `[redacted]` marks per string; past this the rest stays plain text. */
const MAX_MARKS = 100;

type Container = readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** What the viewer knows about one rendered tree item. */
interface TreeNode {
  readonly li: HTMLLIElement;
  readonly value: JsonValue;
  readonly parent: TreeNode | null;
  /** Child count; 0 for leaves and empty containers. */
  readonly size: number;
  /** An object's keys, read once; `null` for arrays and leaves. */
  readonly keys: readonly string[] | null;
  summary: HTMLElement | null;
  group: HTMLUListElement | null;
  more: HTMLLIElement | null;
  /** Children rendered so far. */
  shown: number;
  /** A long string's full text, until "Show all" is used. */
  full: string | null;
}

/**
 * The shared JSON tree (D-04, FR-COM-01, FR-COM-02). Built with DOM calls
 * only: every key and value becomes a text node, so captured data is never
 * parsed as HTML (NFR-SEC-01, ISO-04).
 *
 * Children are rendered when their parent opens and removed when it closes,
 * a page at a time, so a 2,000-key object costs 100 items. No recursion
 * anywhere — a 10,000-level body parsed by a view cannot overflow the stack.
 */
export function createJsonViewer(doc: Document, value: JsonValue, options: JsonViewerOptions): JsonViewer {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  const longLimit = Math.max(1, options.longStringLimit ?? DEFAULT_LONG_STRING);
  const redacted = options.redactedValue;
  /** `redactedValue` as it appears inside a JSON-escaped string. */
  const redactedEscaped = redacted === '' ? '' : JSON.stringify(redacted).slice(1, -1);

  const nodes = new WeakMap<Element, TreeNode>();
  const mores = new WeakMap<Element, TreeNode>();
  let count = 0;
  let destroyed = false;

  const tree = doc.createElement('ul');
  tree.className = 'dcp-json';
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', options.ariaLabel);

  const root = createNode(value, null, null);
  tree.appendChild(root.li);
  let active: HTMLLIElement = root.li;
  active.tabIndex = 0;
  openInitially(Math.max(0, options.expandDepth ?? 1));

  const onClick = guard((event: Event) => {
    const target = event.target as Element;
    if (target.closest('.dcp-json-show-all') !== null) {
      const li = target.closest('li');
      const node = li === null ? undefined : nodes.get(li);
      if (node !== undefined) {
        showAll(node);
        focus(node.li);
      }
      return;
    }
    const li = target.closest('li');
    if (li === null || !tree.contains(li)) {
      return;
    }
    const owner = mores.get(li);
    if (owner !== undefined) {
      focus(li);
      showMore(owner);
      return;
    }
    const node = nodes.get(li);
    if (node === undefined) {
      return;
    }
    focus(li);
    if (node.size > 0) {
      toggle(node);
    }
  });

  const onKeydown = guard((event: Event) => {
    const key = event as KeyboardEvent;
    if (key.altKey || key.ctrlKey || key.metaKey) {
      return;
    }
    const li = (key.target as Element).closest('li');
    if (li === null || !tree.contains(li)) {
      return;
    }
    if (li !== active && (nodes.has(li) || mores.has(li))) {
      active.tabIndex = -1;
      li.tabIndex = 0;
      active = li;
    }
    if (handleKey(li, key.key)) {
      return;
    }
    key.preventDefault();
  });

  tree.addEventListener('click', onClick);
  tree.addEventListener('keydown', onKeydown);

  return {
    element: tree,
    expandAll(maxNodes: number): boolean {
      return destroyed ? false : expandAll(maxNodes);
    },
    collapseAll(): void {
      if (!destroyed) {
        close(root);
      }
    },
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      tree.removeEventListener('click', onClick);
      tree.removeEventListener('keydown', onKeydown);
      tree.replaceChildren();
      tree.remove();
    },
  };

  /** Returns `true` when the key is not ours (the event is left alone). */
  function handleKey(li: HTMLLIElement, key: string): boolean {
    const owner = mores.get(li);
    const node = nodes.get(li);
    switch (key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        move(li, key);
        return false;
      case 'ArrowRight':
        if (node !== undefined && node.size > 0) {
          if (node.group === null) {
            open(node);
          } else if (node.group.firstElementChild !== null) {
            focus(node.group.firstElementChild as HTMLLIElement);
          }
        }
        return false;
      case 'ArrowLeft': {
        if (node !== undefined && node.group !== null) {
          close(node);
          return false;
        }
        const parent = node?.parent ?? owner;
        if (parent !== undefined && parent !== null) {
          focus(parent.li);
        }
        return false;
      }
      case 'Enter':
      case ' ':
        if (owner !== undefined) {
          showMore(owner);
        } else if (node !== undefined && node.size > 0) {
          toggle(node);
        } else if (node !== undefined && node.full !== null) {
          showAll(node);
        }
        return false;
      default:
        return true;
    }
  }

  /** Visible items are exactly the rendered ones: closed children are not in the DOM. */
  function move(from: HTMLLIElement, key: string): void {
    const all = tree.querySelectorAll<HTMLLIElement>('li[role="treeitem"]');
    let index = Array.prototype.indexOf.call(all, from) as number;
    if (key === 'Home') {
      index = 0;
    } else if (key === 'End') {
      index = all.length - 1;
    } else {
      index = Math.min(all.length - 1, Math.max(0, index + (key === 'ArrowDown' ? 1 : -1)));
    }
    focus(all[index]);
  }

  /** Roving tabindex: one item is in the tab order, and it is the one last used. */
  function focus(li: HTMLLIElement): void {
    if (active !== li) {
      active.tabIndex = -1;
      li.tabIndex = 0;
      active = li;
    }
    li.focus();
  }

  function toggle(node: TreeNode): void {
    if (node.group === null) {
      open(node);
    } else {
      close(node);
    }
  }

  function open(node: TreeNode): void {
    if (node.size === 0 || node.group !== null) {
      return;
    }
    const groupEl = doc.createElement('ul');
    groupEl.className = 'dcp-json-group';
    groupEl.setAttribute('role', 'group');
    node.group = groupEl;
    node.shown = 0;
    node.li.appendChild(groupEl);
    node.li.setAttribute('aria-expanded', 'true');
    setSummary(node, true);
    renderPage(node);
  }

  /** Drops the children from the DOM; reopening builds them again, closed. */
  function close(node: TreeNode): void {
    const groupEl = node.group;
    if (groupEl === null) {
      return;
    }
    count -= groupEl.getElementsByTagName('li').length;
    const hadFocus = groupEl.contains(doc.activeElement);
    if (groupEl.contains(active)) {
      active.tabIndex = -1;
      active = node.li;
      active.tabIndex = 0;
    }
    groupEl.remove();
    node.group = null;
    node.more = null;
    node.shown = 0;
    node.li.setAttribute('aria-expanded', 'false');
    setSummary(node, false);
    if (hadFocus) {
      node.li.focus();
    }
  }

  /** Moves focus (and the tab stop) from the "Show more" item to the first child it revealed. */
  function showMore(node: TreeNode): void {
    const more = node.more;
    if (more === null || node.group === null) {
      return;
    }
    const hadFocus = more === doc.activeElement;
    const first = node.shown;
    renderPage(node);
    const next = node.group.children[first] as HTMLLIElement | undefined;
    if (next === undefined) {
      return;
    }
    if (active === more) {
      active = next;
      next.tabIndex = 0;
    }
    if (hadFocus) {
      focus(next);
    }
  }

  /** Adds the next page of children, and the "Show more" item if any are left. */
  function renderPage(node: TreeNode): void {
    const groupEl = node.group;
    if (groupEl === null) {
      return;
    }
    if (node.more !== null) {
      node.more.remove();
      mores.delete(node.more);
      node.more = null;
      count--;
    }
    const container = node.value as Container;
    const end = Math.min(node.size, node.shown + pageSize);
    const fragment = doc.createDocumentFragment();
    if (Array.isArray(container)) {
      for (let i = node.shown; i < end; i++) {
        fragment.appendChild(createNode(container[i], String(i), node).li);
      }
    } else {
      const keys = node.keys as readonly string[];
      const object = container as { readonly [key: string]: JsonValue };
      for (let i = node.shown; i < end; i++) {
        fragment.appendChild(createNode(object[keys[i]], keys[i], node).li);
      }
    }
    node.shown = end;
    const left = node.size - end;
    if (left > 0) {
      const more = doc.createElement('li');
      more.className = 'dcp-json-more';
      more.setAttribute('role', 'treeitem');
      more.tabIndex = -1;
      more.textContent = `Show ${group(Math.min(pageSize, left))} more (${group(left)} hidden)`;
      mores.set(more, node);
      node.more = more;
      fragment.appendChild(more);
      count++;
    }
    groupEl.appendChild(fragment);
  }

  function createNode(value: JsonValue, key: string | null, parent: TreeNode | null): TreeNode {
    const li = doc.createElement('li');
    li.className = 'dcp-json-item';
    li.setAttribute('role', 'treeitem');
    li.tabIndex = -1;
    const line = doc.createElement('div');
    line.className = 'dcp-json-line';
    li.appendChild(line);

    const keys = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : null;
    const size = keys !== null ? keys.length : Array.isArray(value) ? value.length : 0;
    const toggleEl = doc.createElement('span');
    toggleEl.className = size > 0 ? 'dcp-json-toggle' : 'dcp-json-spacer';
    toggleEl.setAttribute('aria-hidden', 'true');
    line.appendChild(toggleEl);

    if (key !== null) {
      line.appendChild(span(isPlaceholderKey(key) ? 'dcp-json-key dcp-json-placeholder' : 'dcp-json-key', cut(key)));
      line.appendChild(doc.createTextNode(': '));
    }

    const node: TreeNode = {
      li,
      value,
      parent,
      size,
      keys,
      summary: null,
      group: null,
      more: null,
      shown: 0,
      full: null,
    };
    nodes.set(li, node);
    count++;
    if (size > 0) {
      li.setAttribute('aria-expanded', 'false');
      node.summary = span('dcp-json-summary', '');
      line.appendChild(node.summary);
      setSummary(node, false);
    } else {
      appendLeaf(line, value, node);
    }
    return node;
  }

  function appendLeaf(line: HTMLElement, value: JsonValue, node: TreeNode): void {
    if (value === null || typeof value === 'boolean') {
      line.appendChild(span('dcp-json-literal', String(value)));
      return;
    }
    if (typeof value === 'number') {
      line.appendChild(span('dcp-json-number', String(value)));
      return;
    }
    if (typeof value === 'object') {
      line.appendChild(span('dcp-json-summary', Array.isArray(value) ? '[]' : '{}'));
      return;
    }
    const kind = classifyJsonString(value, redacted);
    switch (kind.kind) {
      case 'redacted':
        line.appendChild(badge('redacted', 'redacted'));
        return;
      case 'placeholder':
        line.appendChild(span('dcp-json-placeholder', kind.text));
        return;
      case 'truncated':
        line.appendChild(stringSpan(kind.kept, node, true));
        line.appendChild(doc.createTextNode(' '));
        line.appendChild(badge('truncated', kind.note));
        appendShowAll(line, node);
        return;
      default:
        line.appendChild(stringSpan(kind.text, node, false));
        appendShowAll(line, node);
    }
  }

  /** A JSON-quoted string; past the limit, only its start, and the rest kept for "Show all". */
  function stringSpan(text: string, node: TreeNode, cutByV1: boolean): HTMLElement {
    const long = text.length > longLimit;
    node.full = long ? text : null;
    const shown = long ? text.slice(0, longLimit) : text;
    const el = doc.createElement('span');
    el.className = 'dcp-json-string';
    el.dir = 'auto';
    const quoted = JSON.stringify(shown);
    fillMarked(el, long || cutByV1 ? `${quoted.slice(0, -1)}…"` : quoted);
    return el;
  }

  function appendShowAll(line: HTMLElement, node: TreeNode): void {
    if (node.full === null) {
      return;
    }
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'dcp-json-show-all';
    button.tabIndex = -1;
    button.textContent = `Show all (${group(node.full.length)} chars)`;
    line.appendChild(button);
  }

  function showAll(node: TreeNode): void {
    const full = node.full;
    if (full === null) {
      return;
    }
    node.full = null;
    const line = node.li.firstElementChild as HTMLElement;
    const stringEl = line.querySelector('.dcp-json-string');
    const truncated = line.querySelector('.dcp-badge--truncated') !== null;
    if (stringEl !== null) {
      stringEl.replaceChildren();
      const quoted = JSON.stringify(full);
      fillMarked(stringEl as HTMLElement, truncated ? `${quoted.slice(0, -1)}…"` : quoted);
    }
    line.querySelector('.dcp-json-show-all')?.remove();
  }

  /** Text with each `redactedValue` inside it marked (FR-HTTP-07); text nodes only. */
  function fillMarked(el: HTMLElement, text: string): void {
    let from = 0;
    if (redactedEscaped !== '') {
      for (let marks = 0; marks < MAX_MARKS; marks++) {
        const at = text.indexOf(redactedEscaped, from);
        if (at === -1) {
          break;
        }
        if (at > from) {
          el.appendChild(doc.createTextNode(text.slice(from, at)));
        }
        el.appendChild(span('dcp-json-redacted', redactedEscaped));
        from = at + redactedEscaped.length;
      }
    }
    if (from < text.length) {
      el.appendChild(doc.createTextNode(from === 0 ? text : text.slice(from)));
    }
  }

  /** `Array(3)` when open; `Array(3) [1, 2, 3]` when closed. */
  function setSummary(node: TreeNode, opened: boolean): void {
    if (node.summary === null) {
      return;
    }
    const isArray = Array.isArray(node.value);
    const label = `${isArray ? 'Array' : 'Object'}(${node.size})`;
    node.summary.textContent = opened ? label : `${label} ${preview(node)}`;
  }

  /** One line, reading only as many children as fit in it. */
  function preview(node: TreeNode): string {
    const isArray = Array.isArray(node.value);
    const container = node.value as Container;
    const keys = node.keys;
    let text = '';
    for (let i = 0; i < node.size && text.length <= PREVIEW_CHARS; i++) {
      const key = keys === null ? null : keys[i];
      const child =
        keys === null
          ? (container as readonly JsonValue[])[i]
          : (container as { readonly [k: string]: JsonValue })[key as string];
      text += `${i === 0 ? '' : ', '}${key === null ? '' : `${key.slice(0, PREVIEW_CHARS)}: `}${previewOf(child)}`;
    }
    const open = isArray ? '[' : '{';
    const shut = isArray ? ']' : '}';
    return text.length > PREVIEW_CHARS ? `${open}${text.slice(0, PREVIEW_CHARS)}…` : `${open}${text}${shut}`;
  }

  function previewOf(value: JsonValue): string {
    if (value === null || typeof value !== 'object') {
      if (typeof value !== 'string') {
        return String(value);
      }
      const kind = classifyJsonString(value, redacted);
      switch (kind.kind) {
        case 'redacted':
          return redacted;
        case 'placeholder':
          return kind.text;
        case 'truncated':
          return `${JSON.stringify(kind.kept.slice(0, PREVIEW_CHARS)).slice(0, -1)}…"`;
        default:
          return JSON.stringify(value.slice(0, PREVIEW_CHARS + 1));
      }
    }
    if (Array.isArray(value)) {
      return value.length === 0 ? '[]' : '[…]';
    }
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        return '{…}';
      }
    }
    return '{}';
  }

  function badge(kind: JsonBadgeKind, text: string): HTMLElement {
    const el = doc.createElement('span');
    el.className = `dcp-badge dcp-badge--${kind}`;
    let icon: Node | null = null;
    try {
      icon = options.badgeIcon?.(kind) ?? null;
    } catch {
      // A failing icon costs the icon, never the tree (ISO-12).
    }
    if (icon !== null) {
      el.appendChild(icon);
    }
    el.appendChild(doc.createTextNode(text));
    return el;
  }

  function span(className: string, text: string): HTMLElement {
    const el = doc.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  }

  /** Keys get no "Show all": past the limit they are cut with an ellipsis. */
  function cut(text: string): string {
    return text.length > longLimit ? `${text.slice(0, longLimit)}…` : text;
  }

  /** Opens levels below `expandDepth`, breadth first, within `INITIAL_ITEMS`. */
  function openInitially(depth: number): void {
    let level: TreeNode[] = [root];
    for (let d = 0; d < depth && level.length > 0; d++) {
      const next: TreeNode[] = [];
      for (const node of level) {
        if (node.size === 0) {
          continue;
        }
        if (count + Math.min(node.size, pageSize) + 1 > INITIAL_ITEMS) {
          return;
        }
        open(node);
        collectChildren(node, next);
      }
      level = next;
    }
  }

  function expandAll(maxNodes: number): boolean {
    const queue: TreeNode[] = [root];
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];
      if (node.size === 0) {
        continue;
      }
      if (node.group === null) {
        const shown = Math.min(node.size, pageSize);
        if (count + shown + (node.size > shown ? 1 : 0) > maxNodes) {
          return false;
        }
        open(node);
      }
      collectChildren(node, queue);
      // A long queue of finished nodes is dropped as it goes, so memory stays at one level.
      if (head > 1024) {
        queue.splice(0, head + 1);
        head = -1;
      }
    }
    return true;
  }

  function collectChildren(node: TreeNode, into: TreeNode[]): void {
    const children = node.group === null ? null : node.group.children;
    if (children === null) {
      return;
    }
    for (let i = 0; i < children.length; i++) {
      const child = nodes.get(children[i]);
      if (child !== undefined && child.size > 0) {
        into.push(child);
      }
    }
  }
}

/** Listeners never throw into the host (ISO-12): a failure costs one interaction, silently. */
function guard(listener: (event: Event) => void): (event: Event) => void {
  return (event) => {
    try {
      listener(event);
    } catch {
      // Nothing to report to: the console is the recorder's input.
    }
  };
}
