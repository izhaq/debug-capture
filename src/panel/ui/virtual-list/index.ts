/**
 * Virtual list (S-04, S04-05): a framework-free grid that renders only the
 * visible rows, for lists of any length (NFR-PERF-04, ISO-10).
 */
export { createVirtualList } from './virtual-list';
export { VIRTUAL_LIST_CSS } from './virtual-list-css';
export type { VirtualList, VirtualListColumn, VirtualListOptions, VirtualListSort } from './types';
