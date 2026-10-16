/** One column of a virtual list. */
export interface VirtualListColumn {
  /** Passed back to `renderCell`; unique within the list. */
  readonly key: string;
  /** Header text. Always set as text, never parsed. */
  readonly label: string;
  /** Fixed width in px, or `'flex'` to share the width that is left. */
  readonly width: number | 'flex';
}

/** What a caller passes to `createVirtualList`. */
export interface VirtualListOptions<T> {
  /** Fixed row height in px: 20 / 22 / 26 by text size (HLD §5.3). */
  readonly rowHeight: number;
  readonly columns: readonly VirtualListColumn[];
  /** The grid's accessible name. */
  readonly ariaLabel: string;
  /**
   * Fills one cell. The cell arrives empty, with only its base class and no
   * `title`; set every other attribute each time, because cells are reused.
   * Use text nodes and safe elements only (ISO-04).
   */
  renderCell(item: T, columnKey: string, cell: HTMLElement): void;
  /** Stable identity of an item across `setItems` calls (rows, selection and scroll anchor follow it). */
  getKey(item: T): string | number;
  /** Extra row class, e.g. `dcp-row--error` / `dcp-row--warn` for the tints. */
  rowClass?(item: T): string | undefined;
  /** The user moved the selection (keyboard or click). Not called for `select()` or `setItems`. */
  onSelect?(item: T, index: number): void;
  /**
   * `setItems` dropped the selection because its item left the list (e.g.
   * evicted from the buffer), so the detail pane can say so without polling.
   * Not called for `select(null)`.
   */
  onSelectionLost?(): void;
  /** The user opened a row (Enter or double-click). */
  onActivate?(item: T, index: number): void;
  /** Rows rendered above and below the visible ones. Default 8. */
  readonly overscan?: number;
  /** Show the column header row. Default `true` (the Console list has none). */
  readonly header?: boolean;
  /**
   * Runs work in the next frame (S-08's scheduler, already outside Angular's
   * zone). Only resize re-renders use it — never inside the ResizeObserver
   * callback itself (ISO-12). Default: the document window's
   * `requestAnimationFrame`. Scroll and `setItems` always render at once.
   */
  readonly requestFrame?: (callback: () => void) => void;
  /** Gets errors thrown by the callbacks above; they never escape the list (ISO-12). Default: ignored. */
  onError?(error: unknown): void;
}

/** A mounted virtual list. */
export interface VirtualList<T> {
  /** The scroll container (`role="grid"`). Put it in a flex column or give it a height. */
  readonly element: HTMLElement;
  /** The selected row, or `null`. */
  readonly selectedIndex: number | null;
  /**
   * Replaces the items. Costs O(visible rows): rows whose key and item are
   * unchanged are only moved. At the end it stays at the end (follow);
   * scrolled up, the first visible entry stays put.
   */
  setItems(items: readonly T[]): void;
  /** Selects a row without scrolling and without `onSelect`; `null` clears. */
  select(index: number | null): void;
  /** Scrolls the least needed to show the row. */
  scrollToIndex(index: number): void;
  /** Scrolls to the last row (the "↓ N new" button). */
  scrollToEnd(): void;
  /** `true` when scrolled to the bottom (within half a row). */
  isAtEnd(): boolean;
  /** Called on every scroll with `isAtEnd()`. Returns an unsubscribe function. */
  onScrollChange(listener: (atEnd: boolean) => void): () => void;
  /** Changes the row height (text size setting); keeps the first visible row in place. */
  setRowHeight(px: number): void;
  /** Re-renders the visible cells (e.g. the time format changed). */
  refresh(): void;
  /** Removes every listener and the observer, and the element from its parent. */
  destroy(): void;
}
