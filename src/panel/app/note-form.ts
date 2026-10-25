import { createButton, createListeners, Dom, ErrorReporter } from '../views';

export interface NoteForm {
  readonly element: HTMLElement;
  /** The Title box: where focus goes when the form opens. */
  readonly title: HTMLInputElement;
  destroy(): void;
}

/**
 * The Add note form (`FR-NOTE-01`): Title, Text and **Add note**. No `<form>`
 * element, so nothing can submit and navigate the host page. `onAdd` gets the
 * trimmed values; with both empty nothing is added and focus goes back to
 * Title. Enter in Title, or Ctrl+Enter in Text, adds too.
 */
export function createNoteForm(
  dom: Dom,
  onAdd: (title: string, text: string) => void,
  onError?: ErrorReporter,
): NoteForm {
  const title = dom.el('input', {
    className: 'dcp-input',
    attrs: { type: 'text', 'aria-label': 'Title', maxlength: 200 },
  });
  const text = dom.el('textarea', { className: 'dcp-input dcp-note__text', attrs: { 'aria-label': 'Text' } });
  const add = (): void => {
    const t = title.value.trim();
    const x = text.value.trim();
    if (t === '' && x === '') {
      title.focus();
      return;
    }
    title.value = '';
    text.value = '';
    onAdd(t, x);
  };
  const button = createButton(dom, { label: 'Add note', onClick: add, onError });
  const element = dom.el('div', { className: 'dcp-note' }, [
    dom.el('label', { className: 'dcp-note__field' }, ['Title', title]),
    dom.el('label', { className: 'dcp-note__field' }, ['Text', text]),
    button.element,
  ]);
  const listeners = createListeners(onError);
  listeners.on(element, 'keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.altKey || event.shiftKey) return;
    const inText = event.target === text;
    if (inText ? event.ctrlKey || event.metaKey : event.target === title) {
      event.preventDefault();
      add();
    }
  });
  return {
    element,
    title,
    destroy(): void {
      listeners.removeAll();
      button.destroy();
    },
  };
}
