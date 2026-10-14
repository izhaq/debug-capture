/**
 * L3 adapters barrel — the only impure code: probes that patch globals and
 * sinks that write files / the clipboard. May import only the core barrel and
 * its own child barrels; re-exports core so install needs one import path.
 */
export * from '../core';
export * from './probes';
export * from './sinks';
