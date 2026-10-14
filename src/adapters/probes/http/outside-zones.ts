/**
 * Runs probe bookkeeping outside every zone when zone.js is loaded.
 *
 * zone.js turns each `addEventListener` callback and each promise callback
 * into a task of the zone it was registered in. Registered from inside
 * Angular's zone, every probe callback is one more task there — and Angular
 * runs change detection after each one: a socket streaming frames would pay
 * for a second detection pass per frame. Probe callbacks never touch app
 * state, so they belong in the root zone.
 *
 * `Zone` is read structurally off the global scope, never imported — this
 * layer has no package imports (layer rule 5). Without zone.js the work just
 * runs. `scope` is injectable for specs only.
 *
 * Duplicated in `websocket/outside-zones.ts` on purpose: sibling probe modules
 * cannot share code (layer rule 4). Keep the two copies identical.
 */
export function outsideZones<T>(work: () => T, scope: object = globalThis): T {
  const zone = (scope as { Zone?: { root?: { run?: unknown } } }).Zone;
  const root = zone?.root;
  if (root && typeof root.run === 'function') {
    return (root.run as (fn: () => T) => T).call(root, work);
  }
  return work();
}
