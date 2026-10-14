/**
 * L3 http probe barrel — patches XHR and fetch.
 * May import only files in this directory and the core barrel (../../../core).
 * `http-helpers.ts` and `outside-zones.ts` are module-internal and deliberately not exported.
 */
export { installXhrProbe } from './xhr.probe';
export type { XhrHost } from './xhr.probe';
export { installFetchProbe } from './fetch.probe';
export type { FetchHost } from './fetch.probe';
