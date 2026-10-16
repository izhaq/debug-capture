import { createButton, ButtonControl } from './button';
import { Dom, ErrorReporter } from './dom';

/** Options for `createEmptyState`. */
export interface EmptyStateOptions {
  /** E.g. "No requests yet." or "No entries match the filter." (HLD §4.11). */
  readonly message: string;
  /** An optional button, e.g. **Clear filters** for the no-match state. */
  readonly action?: { readonly label: string; readonly onClick: () => void };
  readonly onError?: ErrorReporter;
}

/** An empty or no-match block built by `createEmptyState`. */
export interface EmptyStateControl {
  readonly element: HTMLElement;
  setMessage(message: string): void;
  /** Removes the button's listener. */
  destroy(): void;
}

/** The list area's empty / no-match block (FR-COM-04). */
export function createEmptyState(dom: Dom, options: EmptyStateOptions): EmptyStateControl {
  const message = dom.el('p', { className: 'dcp-empty__message' }, [options.message]);
  const action: ButtonControl | null = options.action
    ? createButton(dom, { label: options.action.label, onClick: options.action.onClick, onError: options.onError })
    : null;
  const element = dom.el('div', { className: 'dcp-empty' }, [message, action?.element]);
  return {
    element,
    setMessage: (text) => {
      message.textContent = text;
    },
    destroy: () => action?.destroy(),
  };
}
