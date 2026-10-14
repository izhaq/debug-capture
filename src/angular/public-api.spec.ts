import { CAPTURE_SCHEMA_VERSION, DEFAULT_CAPTURE_POLICY, DEFAULT_SHORTCUTS } from './index';

describe('debug-capture Angular public API', () => {
  it('re-exports the contract through every layer', () => {
    // The app imports only this barrel, so the whole contract must reach it.
    expect(CAPTURE_SCHEMA_VERSION).toBe(1);
    expect(DEFAULT_CAPTURE_POLICY.maxEntries).toBe(5000);
    expect(DEFAULT_SHORTCUTS.download).toBe('ctrl+alt+shift+d');
  });
});
