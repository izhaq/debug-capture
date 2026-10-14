/** `localStorage.setItem('debug-capture', '1')` turns capture on for every page load in this browser. */
export const DEBUG_STORAGE_KEY = 'debug-capture';

const QUERY_VALUES: readonly string[] = ['1', 'true'];

/**
 * The on/off flag, read once before bootstrap: `?debug=1` (or `?debug=true`)
 * in the URL for one page load, or `debug-capture=1` in `localStorage` for a
 * station that should always capture. Without either, nothing is patched.
 *
 * Never throws. Reading `localStorage` can throw — private windows, blocked
 * site data, sandboxed iframes — and even reaching the `localStorage`
 * property can; all of that counts as "not set", so the app still boots.
 */
export function isDebugRequested(
  location?: { readonly search: string },
  storage?: Pick<Storage, 'getItem'> | null,
): boolean {
  return queryRequested(location) || storageRequested(storage);
}

function queryRequested(location: { readonly search: string } | undefined): boolean {
  try {
    const search = (location ?? globalThis.location)?.search ?? '';
    const value = new URLSearchParams(search).get('debug');
    return value !== null && QUERY_VALUES.includes(value);
  } catch {
    return false;
  }
}

function storageRequested(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    return store?.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
