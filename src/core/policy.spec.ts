import { DEFAULT_CAPTURE_POLICY, EntryDraft } from '../contract';
import { resolvePolicy } from './policy';

describe('resolvePolicy', () => {
  it('returns the defaults when no overrides are given', () => {
    expect(resolvePolicy()).toEqual(DEFAULT_CAPTURE_POLICY);
    expect(resolvePolicy({})).toEqual(DEFAULT_CAPTURE_POLICY);
  });

  it('applies overrides', () => {
    const sample = (draft: EntryDraft): boolean => draft.kind !== 'ws';
    const policy = resolvePolicy({
      maxEntries: 10,
      maxBodyLength: 0,
      maxArgDepth: 0,
      redactJsonKeys: ['pin'],
      ignoreUrls: [/\/health$/],
      sample,
    });

    expect(policy.maxEntries).toBe(10);
    expect(policy.maxBodyLength).toBe(0);
    expect(policy.maxArgDepth).toBe(0);
    expect(policy.redactJsonKeys).toEqual(['pin']);
    expect(policy.ignoreUrls).toEqual([/\/health$/]);
    expect(policy.sample).toBe(sample);
    // Untouched fields keep their defaults.
    expect(policy.redactHeaders).toEqual(DEFAULT_CAPTURE_POLICY.redactHeaders);
    expect(policy.redactedValue).toBe('[redacted]');
  });

  it('treats an undefined override as not given', () => {
    expect(resolvePolicy({ maxEntries: undefined, redactedValue: undefined })).toEqual(DEFAULT_CAPTURE_POLICY);
  });

  it('throws RangeError naming the field for invalid limits', () => {
    const cases: Array<[string, Parameters<typeof resolvePolicy>[0]]> = [
      ['maxEntries', { maxEntries: 0 }],
      ['maxEntries', { maxEntries: 2.5 }],
      ['maxEntries', { maxEntries: Number.NaN }],
      ['maxBodyLength', { maxBodyLength: -1 }],
      ['maxBodyLength', { maxBodyLength: Number.POSITIVE_INFINITY }],
      ['maxArgDepth', { maxArgDepth: -1 }],
      ['maxArgDepth', { maxArgDepth: 1.5 }],
    ];

    for (const [field, overrides] of cases) {
      expect(() => resolvePolicy(overrides)).toThrowMatching(
        (error: unknown) => error instanceof RangeError && error.message.includes(field),
      );
    }
  });

  it('returns a frozen policy', () => {
    const headers = ['x-secret'];
    const policy = resolvePolicy({ redactHeaders: headers });

    expect(Object.isFrozen(policy)).toBeTrue();
    expect(Object.isFrozen(policy.redactHeaders)).toBeTrue();
    expect(Object.isFrozen(policy.redactJsonKeys)).toBeTrue();
    expect(Object.isFrozen(policy.redactBodyUrls)).toBeTrue();
    expect(Object.isFrozen(policy.ignoreUrls)).toBeTrue();

    // The caller's array is copied, so mutating it later cannot change the policy.
    headers.push('x-other');
    expect(policy.redactHeaders).toEqual(['x-secret']);
  });
});
