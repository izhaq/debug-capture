/**
 * L3 global-error probe barrel — listens for uncaught errors and unhandled rejections.
 * May import only files in this directory and the core barrel (../../../core).
 */
export { installGlobalErrorProbe } from './global-error.probe';
export type { ErrorEventHost } from './global-error.probe';
