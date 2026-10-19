import type { CreateView } from '../../ui';

/**
 * Stub from the contract PR (C3-1): an empty view, so the frame (S-08) can
 * mount the HTTP tab before S-05 lands. S-05 replaces this file.
 */
export const createHttpView: CreateView = (deps) => {
  const element = deps.document.createElement('div');
  element.className = 'dcp-view';
  return {
    element,
    update: () => undefined,
    applySettings: () => undefined,
    focusFilter: () => undefined,
    handleEscape: () => false,
    destroy: () => element.remove(),
  };
};

/** The HTTP view's own rules (`dcp-http-*`); empty until S-05. */
export const HTTP_VIEW_CSS = '';
