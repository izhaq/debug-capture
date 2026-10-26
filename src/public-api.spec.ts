import { CAPTURE_SCHEMA_VERSION, DEFAULT_CAPTURE_POLICY, DEFAULT_SHORTCUTS } from './index';

describe('debug-capture public API', () => {
  it('re-exports the contract through every layer', () => {
    // Reaching these through ./index proves the chain
    // install → adapters → core → contract re-exports end to end.
    expect(CAPTURE_SCHEMA_VERSION).toBe(2);
    expect(DEFAULT_CAPTURE_POLICY.maxEntries).toBe(5000);
    expect(DEFAULT_SHORTCUTS.download).toBe('ctrl+alt+shift+d');
  });
});
