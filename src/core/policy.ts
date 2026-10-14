import { CapturePolicy, DEFAULT_CAPTURE_POLICY } from '../contract';

type LimitField = 'maxEntries' | 'maxBodyLength' | 'maxArgDepth';

/**
 * Merges `overrides` onto the defaults and validates the limits.
 *
 * The one function in core that may throw: it runs at install time, before
 * any global is patched, so a bad config fails loudly instead of producing a
 * recorder that silently keeps nothing. The result and its arrays are frozen
 * copies, so a caller mutating its own arrays later cannot change the rules.
 */
export function resolvePolicy(overrides: Partial<CapturePolicy> = {}): CapturePolicy {
  const merged: CapturePolicy = { ...DEFAULT_CAPTURE_POLICY, ...withoutUndefined(overrides) };

  requireInteger(merged, 'maxEntries', 1);
  requireInteger(merged, 'maxBodyLength', 0);
  requireInteger(merged, 'maxArgDepth', 0);

  return Object.freeze({
    ...merged,
    redactHeaders: Object.freeze(merged.redactHeaders.slice()),
    redactJsonKeys: Object.freeze(merged.redactJsonKeys.slice()),
    redactBodyUrls: Object.freeze(merged.redactBodyUrls.slice()),
    ignoreUrls: Object.freeze(merged.ignoreUrls.slice()),
  });
}

function requireInteger(policy: CapturePolicy, field: LimitField, min: number): void {
  const value = policy[field];
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`CapturePolicy.${field} must be an integer >= ${min}, got ${value}`);
  }
}

/** `{ maxEntries: undefined }` means "not given", not "set to undefined". */
function withoutUndefined(overrides: Partial<CapturePolicy>): Partial<CapturePolicy> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(overrides) as Array<keyof CapturePolicy>) {
    if (overrides[key] !== undefined) {
      out[key] = overrides[key];
    }
  }
  return out as Partial<CapturePolicy>;
}
