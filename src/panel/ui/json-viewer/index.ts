/**
 * JSON viewer child barrel (P2): the one tree every view uses for console
 * arguments, HTTP bodies and WebSocket frames (D-04, FR-COM-01, FR-COM-02).
 */
export { createJsonViewer } from './json-viewer';
export type { JsonBadgeKind, JsonViewer, JsonViewerOptions } from './json-viewer';
export { JSON_VIEWER_CSS } from './json-viewer.css';
