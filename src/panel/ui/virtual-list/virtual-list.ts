import type { VirtualList, VirtualListOptions, VirtualListSort } from './types';

const DEFAULT_OVERSCAN = 8;
/**
 * Most rows drawn (visible + overscan) before the overscan shrinks. A real
 * HTTP row is ~22 nodes (7 cells, icon, highlight), so 64 rows ≈ 1,400 nodes,
 * leaving room for the frame and detail under ISO-10's 2,000. Visible rows are
 * always drawn: a list taller than 64 rows gets no overscan.
 */
const ROW_BUDGET = 64;
/**
 * How far (in rows, each way) `setItems` looks for the first visible entry to
 * keep it on screen. A bound keeps the update O(visible rows); past it the
 * scroll position simply stays.
 */
const ANCHOR_SEARCH = 256;

const ROW = 'dcp-row';
const CELL = 'dcp-vlist__cell';

/** Gives each list its own row-id prefix (ids must be unique in one shadow root). */
let listCount = 0;

/** A pooled row node and what it currently shows. */
interface RowRecord<T> {
  readonly el: HTMLElement;
  readonly cells: HTMLElement[];
  item: T | undefined;
  /** -1 when the row must be positioned again. */
  index: number;
  extraClass: string;
  className: string;
  selected: boolean;
}

/**
 * Builds a virtual list (S04-05): a scroll container with a sticky header
 * row and absolutely positioned rows. Only the visible rows plus `overscan`
 * exist in the DOM, and rows are reused by key, so scrolling and `setItems`
 * cost O(visible rows) whatever the item count (NFR-PERF-04, ISO-10).
 *
 * Call it in the root zone (P4 does, ISO-09): listeners and the observer
 * belong to the zone they are created in.
 */
export function createVirtualList<T>(doc: Document, options: VirtualListOptions<T>): VirtualList<T> {
  checkRowHeight(options.rowHeight);
  const columns = options.columns.slice();
  const overscan = Math.max(0, Math.floor(options.overscan ?? DEFAULT_OVERSCAN));
  const headerRows = options.header === false ? 0 : 1;
  const idPrefix = `dcp-vl${++listCount}-r`;
  const win = doc.defaultView;

  let rowHeight = options.rowHeight;
  let items: readonly T[] = [];
  let selectedIndex: number | null = null;
  let selectedKey: unknown = null;
  /** Content-box height from the ResizeObserver; ≤ 0 means "not known yet, measure". */
  let viewportHeight = 0;
  let destroyed = false;
  let framePending = false;
  let frameId: number | null = null;
  let rowCount = 0;
  let rowSerial = 0;

  /** Every row in the DOM, and the same rows by key for reuse. */
  const live = new Set<RowRecord<T>>();
  let byKey = new Map<unknown, RowRecord<T>>();
  const pool: RowRecord<T>[] = [];
  const recordOf = new WeakMap<Element, RowRecord<T>>();
  const scrollListeners = new Set<(atEnd: boolean) => void>();
  /** Sortable headers: one tab stop among them (roving `tabIndex`). */
  const sortButtons: HTMLButtonElement[] = [];
  const sortKeys = new WeakMap<Element, string>();
  const sortCells = new Map<string, HTMLElement>();
  let header: HTMLElement | null = null;
  let newCount = 0;

  const element = doc.createElement('div');
  element.className = 'dcp-vlist';
  element.tabIndex = 0;
  element.setAttribute('role', 'grid');
  element.setAttribute('aria-label', options.ariaLabel);
  element.setAttribute('aria-colcount', String(columns.length));
  element.setAttribute('aria-rowcount', String(headerRows));
  element.style.setProperty(
    '--dcp-vlist-cols',
    columns.map((c) => (c.width === 'flex' ? 'minmax(0, 1fr)' : `${c.width}px`)).join(' '),
  );

  if (headerRows === 1) {
    header = doc.createElement('div');
    header.className = 'dcp-vlist__header';
    header.setAttribute('role', 'row');
    header.setAttribute('aria-rowindex', '1');
    for (const column of columns) {
      const cell = doc.createElement('div');
      cell.className = 'dcp-vlist__colhead';
      cell.setAttribute('role', 'columnheader');
      if (column.sortable === true) {
        // A native button: Enter and Space click it, and it is named by its text.
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'dcp-vlist__sort dcp-focus-inset';
        button.tabIndex = sortButtons.length === 0 ? 0 : -1;
        button.textContent = column.label;
        sortKeys.set(button, column.key);
        sortCells.set(column.key, cell);
        sortButtons.push(button);
        cell.className += ' dcp-vlist__colhead--sortable';
        cell.appendChild(button);
      } else {
        cell.textContent = column.label;
      }
      header.appendChild(cell);
    }
    element.appendChild(header);
  }

  const body = doc.createElement('div');
  body.className = 'dcp-vlist__body';
  body.setAttribute('role', 'rowgroup');
  element.appendChild(body);
  applyRowHeight();

  // Outside the grid: a grid may own only rows (the caller places it).
  const followButton = options.follow === true ? doc.createElement('button') : null;
  if (followButton !== null) {
    followButton.type = 'button';
    followButton.className = 'dcp-btn dcp-vlist__follow';
    followButton.hidden = true;
  }

  // --- callbacks: never let an error out (ISO-12) ---------------------------

  function report(error: unknown): void {
    try {
      options.onError?.(error);
    } catch (_ignored) {
      // Nothing left to tell; the panel must not feed the recorder.
    }
  }

  function keyOf(item: T): unknown {
    try {
      return options.getKey(item);
    } catch (error) {
      report(error);
      return {}; // matches nothing, so the row is simply rendered again
    }
  }

  // --- geometry -------------------------------------------------------------

  function headerHeight(): number {
    return headerRows * rowHeight;
  }

  function viewport(): number {
    if (viewportHeight > 0) return viewportHeight;
    const measured = element.clientHeight;
    if (ro !== null) viewportHeight = measured;
    return measured;
  }

  function maxScrollTop(): number {
    return Math.max(0, headerHeight() + rowCount * rowHeight - viewport());
  }

  /** Rows that fit below the header: the PageUp / PageDown step. */
  function rowsPerPage(): number {
    return Math.max(1, Math.floor((viewport() - headerHeight()) / rowHeight));
  }

  function applyRowHeight(): void {
    element.style.setProperty('--dcp-vlist-row-h', `${rowHeight}px`);
    body.style.height = `${rowCount * rowHeight}px`;
  }

  // --- rendering --------------------------------------------------------------

  function newRecord(): RowRecord<T> {
    const el = doc.createElement('div');
    el.id = `${idPrefix}${rowSerial++}`;
    el.setAttribute('role', 'row');
    el.setAttribute('aria-selected', 'false');
    const cells = columns.map(() => {
      const cell = doc.createElement('div');
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('dir', 'auto');
      el.appendChild(cell);
      return cell;
    });
    const record: RowRecord<T> = {
      el,
      cells,
      item: undefined,
      index: -1,
      extraClass: '',
      className: '',
      selected: false,
    };
    recordOf.set(el, record);
    return record;
  }

  function fill(record: RowRecord<T>, item: T): void {
    record.item = item;
    record.cells.forEach((cell, i) => {
      cell.textContent = '';
      cell.className = CELL;
      cell.removeAttribute('title');
      try {
        options.renderCell(item, columns[i]!.key, cell);
      } catch (error) {
        report(error);
      }
    });
    let extra: string | undefined;
    try {
      extra = options.rowClass?.(item);
    } catch (error) {
      report(error);
    }
    record.extraClass = extra ? ` ${extra}` : '';
  }

  function place(record: RowRecord<T>, index: number, item: T, refill: boolean): void {
    if (refill || record.item !== item) fill(record, item);
    if (record.index !== index) {
      record.index = index;
      record.el.style.top = `${index * rowHeight}px`;
      record.el.setAttribute('aria-rowindex', String(index + 1 + headerRows));
    }
    const selected = index === selectedIndex;
    const className = `${ROW}${index % 2 === 1 ? ` ${ROW}--alt` : ''}${selected ? ` ${ROW}--selected` : ''}${record.extraClass}`;
    if (className !== record.className) {
      record.className = className;
      record.el.className = className;
    }
    if (selected !== record.selected) {
      record.selected = selected;
      record.el.setAttribute('aria-selected', String(selected));
    }
  }

  /**
   * Shows the rows for `scrollTop` (default: the current one). Rows still in
   * range keep their node and, when the item is the same object, their cells.
   */
  function render(refill = false, scrollTop?: number): void {
    if (destroyed) return;
    const vh = viewport();
    const top = Math.min(scrollTop ?? element.scrollTop, maxScrollTop());
    const area = Math.max(0, vh - headerHeight());
    const extra = Math.min(overscan, Math.max(0, Math.floor((ROW_BUDGET - Math.ceil(area / rowHeight) - 1) / 2)));
    const first = Math.max(0, Math.floor(top / rowHeight) - extra);
    const last = Math.min(rowCount, Math.ceil((top + area) / rowHeight) + extra);

    const kept = new Set<RowRecord<T>>();
    const nextByKey = new Map<unknown, RowRecord<T>>();
    const missing: Array<{ index: number; key: unknown }> = [];
    for (let index = first; index < last; index++) {
      const item = items[index] as T;
      const key = keyOf(item);
      const record = byKey.get(key);
      if (record !== undefined && !kept.has(record)) {
        kept.add(record);
        nextByKey.set(key, record);
        place(record, index, item, refill);
      } else {
        missing.push({ index, key });
      }
    }

    const free: RowRecord<T>[] = [];
    live.forEach((record) => {
      if (!kept.has(record)) free.push(record);
    });
    for (const { index, key } of missing) {
      let record = free.pop();
      if (record === undefined) {
        record = pool.pop() ?? newRecord();
        body.appendChild(record.el);
        live.add(record);
      }
      record.index = -1;
      record.item = undefined;
      place(record, index, items[index] as T, true);
      if (!nextByKey.has(key)) nextByKey.set(key, record);
    }
    for (const record of free) {
      record.el.remove();
      live.delete(record);
      pool.push(record);
    }
    byKey = nextByKey;
    updateActiveDescendant();
  }

  function updateActiveDescendant(): void {
    for (const record of live) {
      if (record.selected) {
        element.setAttribute('aria-activedescendant', record.el.id);
        return;
      }
    }
    element.removeAttribute('aria-activedescendant');
  }

  /** Index of `key` in `items`, looking outward from `hint`, at most `limit` rows each way. */
  function findKey(key: unknown, hint: number, limit: number): number | null {
    const n = items.length;
    const reach = Math.min(limit, Math.max(hint, n - hint));
    for (let d = 0; d <= reach; d++) {
      const below = hint - d;
      if (below >= 0 && below < n && keyOf(items[below] as T) === key) return below;
      const above = hint + d;
      if (d > 0 && above >= 0 && above < n && keyOf(items[above] as T) === key) return above;
    }
    return null;
  }

  // --- resize: record only, render in the next frame (ISO-12) ---------------

  function scheduleRender(): void {
    if (framePending || destroyed) return;
    framePending = true;
    const run = (): void => {
      framePending = false;
      frameId = null;
      try {
        render();
      } catch (error) {
        report(error);
      }
    };
    try {
      if (options.requestFrame) options.requestFrame(run);
      else if (win !== null) frameId = win.requestAnimationFrame(run);
    } catch (error) {
      framePending = false;
      report(error);
    }
  }

  const ro =
    win !== null && typeof win.ResizeObserver === 'function'
      ? new win.ResizeObserver((entries) => {
          try {
            const height = entries[entries.length - 1]?.contentRect.height ?? 0;
            if (height !== viewportHeight) {
              viewportHeight = height;
              scheduleRender();
            }
          } catch (error) {
            report(error);
          }
        })
      : null;
  ro?.observe(element);

  // --- events ---------------------------------------------------------------

  function isAtEnd(scrollTop = element.scrollTop): boolean {
    return scrollTop >= maxScrollTop() - rowHeight / 2;
  }

  function onScroll(): void {
    try {
      // One read, before the writes: reading after them would force a layout.
      const top = element.scrollTop;
      render(false, top);
      const atEnd = isAtEnd(top);
      updateFollow(atEnd);
      scrollListeners.forEach((listener) => {
        try {
          listener(atEnd);
        } catch (error) {
          report(error);
        }
      });
    } catch (error) {
      report(error);
    }
  }

  function userSelect(index: number): void {
    if (index === selectedIndex) return;
    setSelection(index);
    scrollToIndex(index);
    try {
      options.onSelect?.(items[index] as T, index);
    } catch (error) {
      report(error);
    }
  }

  function activate(index: number): void {
    try {
      options.onActivate?.(items[index] as T, index);
    } catch (error) {
      report(error);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    try {
      // Header keys are the header's own: Enter must click its button, not open a row.
      if (header !== null && header.contains(event.target as Node | null)) return;
      if (event.altKey || event.ctrlKey || event.metaKey || rowCount === 0) return;
      const current = selectedIndex;
      let next: number;
      switch (event.key) {
        case 'ArrowDown':
          next = current === null ? 0 : current + 1;
          break;
        case 'ArrowUp':
          next = current === null ? rowCount - 1 : current - 1;
          break;
        case 'PageDown':
          next = (current ?? 0) + rowsPerPage();
          break;
        case 'PageUp':
          next = (current ?? 0) - rowsPerPage();
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = rowCount - 1;
          break;
        case 'Enter':
          if (current !== null) {
            event.preventDefault();
            activate(current);
          }
          return;
        default:
          return;
      }
      event.preventDefault();
      userSelect(clamp(next, 0, rowCount - 1));
    } catch (error) {
      report(error);
    }
  }

  /** The row under an event target, or `undefined` (header, empty space). */
  function rowAt(target: EventTarget | null): RowRecord<T> | undefined {
    // No `instanceof Node`: the document may belong to another window (no globals).
    let node = target as Node | null;
    while (node !== null && node !== element) {
      if (node.parentNode === body) return recordOf.get(node as Element);
      node = node.parentNode;
    }
    return undefined;
  }

  function onClick(event: MouseEvent): void {
    try {
      const record = rowAt(event.target);
      if (record !== undefined) userSelect(record.index);
    } catch (error) {
      report(error);
    }
  }

  function onDoubleClick(event: MouseEvent): void {
    try {
      const record = rowAt(event.target);
      if (record !== undefined) activate(record.index);
    } catch (error) {
      report(error);
    }
  }

  function rove(button: HTMLButtonElement): void {
    for (const other of sortButtons) other.tabIndex = other === button ? 0 : -1;
  }

  function onHeaderClick(event: MouseEvent): void {
    try {
      const target = event.target as HTMLButtonElement | null;
      const key = target === null ? undefined : sortKeys.get(target);
      if (target === null || key === undefined) return;
      rove(target);
      options.onSort?.(key);
    } catch (error) {
      report(error);
    }
  }

  function onHeaderKeyDown(event: KeyboardEvent): void {
    try {
      const at = sortButtons.indexOf(event.target as HTMLButtonElement);
      if (at === -1 || event.altKey || event.ctrlKey || event.metaKey) return;
      const last = sortButtons.length - 1;
      let next: number;
      switch (event.key) {
        case 'ArrowLeft':
          next = Math.max(0, at - 1);
          break;
        case 'ArrowRight':
          next = Math.min(last, at + 1);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = last;
          break;
        default:
          return;
      }
      event.preventDefault();
      const button = sortButtons[next] as HTMLButtonElement;
      rove(button);
      button.focus();
    } catch (error) {
      report(error);
    }
  }

  function updateFollow(atEnd: boolean): void {
    if (followButton === null) return;
    const hidden = atEnd || newCount === 0;
    if (followButton.hidden !== hidden) followButton.hidden = hidden;
  }

  function onFollowClick(): void {
    try {
      // Focus first: a focused button that hides would drop focus to the page.
      element.focus({ preventScroll: true });
      scrollToEnd();
    } catch (error) {
      report(error);
    }
  }

  element.addEventListener('scroll', onScroll);
  element.addEventListener('keydown', onKeyDown);
  element.addEventListener('click', onClick);
  element.addEventListener('dblclick', onDoubleClick);
  header?.addEventListener('click', onHeaderClick);
  header?.addEventListener('keydown', onHeaderKeyDown);
  followButton?.addEventListener('click', onFollowClick);

  // --- API ------------------------------------------------------------------

  function setSelection(index: number | null): void {
    selectedIndex = index === null || rowCount === 0 ? null : clamp(index, 0, rowCount - 1);
    selectedKey = selectedIndex === null ? null : keyOf(items[selectedIndex] as T);
    render();
  }

  function scrollToIndex(index: number): void {
    if (destroyed || rowCount === 0) return;
    const i = clamp(index, 0, rowCount - 1);
    const area = viewport() - headerHeight();
    const top = element.scrollTop;
    let next = top;
    if (i * rowHeight < top) next = i * rowHeight;
    else if ((i + 1) * rowHeight > top + area) next = (i + 1) * rowHeight - area;
    if (next !== top) element.scrollTop = next;
    render();
  }

  function setItems(next: readonly T[]): void {
    if (destroyed) return;
    const top = element.scrollTop;
    const atEnd = isAtEnd(top);
    const anchorIndex = Math.floor(top / rowHeight);
    const anchorKey = anchorIndex < rowCount ? keyOf(items[anchorIndex] as T) : undefined;

    items = next;
    rowCount = next.length;
    body.style.height = `${rowCount * rowHeight}px`;
    element.setAttribute('aria-rowcount', String(rowCount + headerRows));

    if (selectedIndex !== null) {
      // Unbounded on purpose: losing the selection closes the detail. It costs
      // O(distance moved), O(n) only once, when the selected entry is gone.
      selectedIndex = findKey(selectedKey, selectedIndex, Infinity);
      if (selectedIndex === null) {
        selectedKey = null;
        try {
          options.onSelectionLost?.();
        } catch (error) {
          report(error);
        }
      }
    }

    let nextTop = top;
    if (atEnd) {
      nextTop = maxScrollTop();
    } else if (anchorKey !== undefined) {
      const moved = findKey(anchorKey, anchorIndex, ANCHOR_SEARCH);
      if (moved !== null) nextTop = top + (moved - anchorIndex) * rowHeight;
    }
    nextTop = Math.min(nextTop, maxScrollTop());
    if (nextTop !== top) element.scrollTop = nextTop;
    render(false, nextTop);
    updateFollow(isAtEnd(nextTop));
  }

  function scrollToEnd(): void {
    if (destroyed) return;
    const top = maxScrollTop();
    element.scrollTop = top;
    render(false, top);
    updateFollow(true);
  }

  function setSort(sort: VirtualListSort | null): void {
    sortCells.forEach((cell, key) => {
      if (sort !== null && key === sort.key)
        cell.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
      else cell.removeAttribute('aria-sort');
    });
  }

  function setNewCount(count: number): void {
    if (destroyed || followButton === null) return;
    const next = count > 0 && Number.isFinite(count) ? Math.floor(count) : 0;
    if (next !== newCount) {
      newCount = next;
      if (next > 0) followButton.textContent = `↓ ${next} new`;
    }
    updateFollow(isAtEnd());
  }

  return {
    element,
    get selectedIndex() {
      return selectedIndex;
    },
    followButton,
    setItems,
    select(index) {
      if (!destroyed) setSelection(index);
    },
    scrollToIndex,
    scrollToEnd,
    setSort,
    setNewCount,
    isAtEnd: () => isAtEnd(),
    onScrollChange(listener) {
      scrollListeners.add(listener);
      return () => {
        scrollListeners.delete(listener);
      };
    },
    setRowHeight(px) {
      checkRowHeight(px);
      if (destroyed) return;
      const top = element.scrollTop;
      const offset = top / rowHeight;
      rowHeight = px;
      applyRowHeight();
      live.forEach((record) => (record.index = -1));
      const nextTop = Math.min(Math.round(offset * rowHeight), maxScrollTop());
      element.scrollTop = nextTop;
      render(false, nextTop);
    },
    refresh() {
      render(true);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('click', onClick);
      element.removeEventListener('dblclick', onDoubleClick);
      header?.removeEventListener('click', onHeaderClick);
      header?.removeEventListener('keydown', onHeaderKeyDown);
      followButton?.removeEventListener('click', onFollowClick);
      followButton?.remove();
      ro?.disconnect();
      if (frameId !== null && win !== null) win.cancelAnimationFrame(frameId);
      scrollListeners.clear();
      live.forEach((record) => record.el.remove());
      live.clear();
      byKey.clear();
      pool.length = 0;
      element.remove();
    },
  };
}

function checkRowHeight(px: number): void {
  if (!(px > 0) || !Number.isFinite(px)) throw new RangeError(`rowHeight must be a positive number of px, got ${px}`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
