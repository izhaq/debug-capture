import type { CreateView } from '../../ui';

/**
 * Stub from the contract PR (C3-1): an empty view, so the frame (S-08) can
 * mount the Console tab before S-07 lands. S-07 replaces this file.
 */
export const createConsoleView: CreateView = (deps) => {
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

/** The Console view's own rules (`dcp-console-*`); empty until S-07. */
export const CONSOLE_VIEW_CSS = '';
