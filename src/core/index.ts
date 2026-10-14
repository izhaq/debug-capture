/**
 * L2 core barrel — pure logic (recorder, policy, serializer, clock), no globals.
 * May import only the contract barrel; re-exports it so the layer below needs
 * a single import path.
 */
export * from '../contract';

export { systemClock } from './clock';
export { RingBuffer } from './ring-buffer';
export { toJsonSafe } from './json-safe';
export { matchesAny, redactHeaders, redactJsonText, redactJsonValue } from './redact';
export { truncate } from './truncate';
export { resolvePolicy } from './policy';
export { createRecorder } from './recorder';
export type { CaptureMeta } from './serializer';
export { buildCaptureFile, defaultCaptureFileName, serializeCaptureFile } from './serializer';
