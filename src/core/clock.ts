import { Clock } from '../contract';

/**
 * The real clock, and the only `Date.now()` in the debug-capture layer.
 * Everything else takes a `Clock` so specs can control time.
 */
export const systemClock: Clock = Object.freeze({ now: (): number => Date.now() });
