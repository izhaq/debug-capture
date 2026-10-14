/**
 * L3 sinks barrel — where an export goes (file download, clipboard).
 * May import only files in this directory and the core barrel (../../core).
 *
 * Sinks take plain strings: install composes serializer → sink.
 */
export { downloadText } from './download.sink';
export type { DownloadHost } from './download.sink';
export { copyText } from './clipboard.sink';
export type { ClipboardHost } from './clipboard.sink';
