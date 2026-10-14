import { DEBUG_STORAGE_KEY, isDebugRequested } from './debug-requested';

function storageWith(values: Record<string, string>): Pick<Storage, 'getItem'> {
  return { getItem: (key: string) => (key in values ? values[key] : null) };
}

const empty = storageWith({});

describe('isDebugRequested', () => {
  it('true for ?debug=1 and ?debug=true', () => {
    expect(isDebugRequested({ search: '?debug=1' }, empty)).toBeTrue();
    expect(isDebugRequested({ search: '?debug=true' }, empty)).toBeTrue();
    expect(isDebugRequested({ search: '?mode=x&debug=1&y=2' }, null)).toBeTrue();
  });

  it('true when storage has debug-capture=1', () => {
    expect(DEBUG_STORAGE_KEY).toBe('debug-capture');
    expect(isDebugRequested({ search: '' }, storageWith({ 'debug-capture': '1' }))).toBeTrue();
  });

  it('false otherwise', () => {
    expect(isDebugRequested({ search: '' }, empty)).toBeFalse();
    expect(isDebugRequested({ search: '?debug=0' }, empty)).toBeFalse();
    expect(isDebugRequested({ search: '?debug=yes' }, empty)).toBeFalse();
    expect(isDebugRequested({ search: '?notdebug=1' }, empty)).toBeFalse();
    expect(isDebugRequested({ search: '' }, storageWith({ 'debug-capture': 'true' }))).toBeFalse();
    expect(isDebugRequested({ search: '' }, null)).toBeFalse();
  });

  it('false when storage throws', () => {
    const blocked: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    };

    expect(isDebugRequested({ search: '' }, blocked)).toBeFalse();
    // The query string still works when storage is blocked.
    expect(isDebugRequested({ search: '?debug=1' }, blocked)).toBeTrue();
  });
});
