/**
 * L4 install barrel — the composition root that wires probes, recorder and
 * sinks into one CaptureSession. May import only the adapters barrel.
 */
export * from '../adapters';

export { createCaptureController, installDebugCapture, getActiveCaptureSession } from './install-debug-capture';
export { isDebugRequested, DEBUG_STORAGE_KEY } from './debug-requested';
export { browserEnvironment } from './environment';
export type { CaptureEnvironment } from './environment';
