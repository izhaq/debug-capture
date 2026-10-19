import type { CreateView } from '../../ui';

/**
 * Stub from the contract PR (C3-1): an empty view, so the frame (S-08) can
 * mount the WebSocket tab before S-06 lands. S-06 replaces this file.
 */
export const createWsView: CreateView = (deps) => {
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

/** The WebSocket view's own rules (`dcp-ws-*`); empty until S-06. */
export const WS_VIEW_CSS = '';
