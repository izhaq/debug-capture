/** Runs `work` and returns its result: in the root zone, or as a plain call. */
export type Run = <T>(work: () => T) => T;

/**
 * `Zone.root.run` when the page loaded zone.js, else a plain call (ISO-09).
 * The loader mounts the UI from the root zone, so listeners added on mount
 * are already outside Angular's zone; data events, though, arrive from the
 * host's code (a probe, inside Angular's zone), and a frame or timer
 * scheduled from there would wake change detection. Read structurally from
 * the panel's own window, never imported. A copy of the loader's helper: P4
 * may not import P5.
 */
export function rootZone(view: unknown): Run {
  const root = (view as { Zone?: { root?: { run?: unknown } } } | null | undefined)?.Zone?.root;
  if (root && typeof root.run === 'function') {
    const zoneRoot = root as { run: Run };
    return (work) => zoneRoot.run(work);
  }
  return (work) => work();
}
