import { CAPTURE_SCHEMA_VERSION, DEFAULT_CAPTURE_POLICY } from './index';

describe('panel app barrel (P4)', () => {
  it('re-exports the contract through every panel layer', () => {
    // Reaching these through ./index proves the chain
    // app → views → ui → model → L5 re-exports end to end.
    expect(CAPTURE_SCHEMA_VERSION).toBe(1);
    expect(DEFAULT_CAPTURE_POLICY.maxEntries).toBe(5000);
  });
});
