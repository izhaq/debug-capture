/**
 * L6 React seam barrel — a sibling of the Angular seam, kept inside
 * src/debug-capture/ so copying that one folder into a React project brings
 * it along. Imports only the L5 barrel ('..') and no packages — not even
 * React. Not re-exported by the L5 barrel: L5 may not import a layer below.
 */
export { createReactRootErrorOptions, recordReactError } from './react-error-handlers';
export type { ReactErrorDefaults, ReactErrorInfo, ReactRootErrorOptions } from './react-error-handlers';
