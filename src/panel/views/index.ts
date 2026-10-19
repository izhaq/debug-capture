/**
 * P3 panel views barrel — title bar, filter bars, HTTP, WebSocket and Console
 * views, settings, status bar. May import only the P2 UI barrel and
 * re-exports it. No packages.
 *
 * The view types (`CreateView`, `PanelView`, `ViewDeps`, `ViewSettings`) come
 * from P2 (`ui/view-contract.ts`, C3-1) through the line below; each view
 * track fills its own folder behind the names exported here.
 */
export * from '../ui';

export { VIEW_CSS } from './view';
export { createHttpView, HTTP_VIEW_CSS } from './http';
export { createWsView, WS_VIEW_CSS } from './ws';
export { createConsoleView, CONSOLE_VIEW_CSS } from './console';
