/**
 * Clipboard sink — puts text on the clipboard, for pasting a capture into a
 * ticket or chat when saving a file is awkward.
 *
 * `navigator.clipboard` exists only in secure contexts (HTTPS or localhost).
 * The air-gapped intranet this ships to is usually served over plain HTTP, so
 * there the `execCommand('copy')` fallback below is the normal path, not an
 * edge case.
 */

/**
 * The globals the copy touches. Injected so specs can pass fakes and never
 * touch the real clipboard, focus or DOM.
 */
export interface ClipboardHost {
  navigator: { clipboard?: Pick<Clipboard, 'writeText'> };
  /** `activeElement` lets the fallback hand focus back to where the user was. */
  document: Pick<Document, 'createElement' | 'body' | 'execCommand' | 'activeElement'>;
  isSecureContext: boolean;
}

function realClipboardHost(): ClipboardHost {
  return { navigator, document, isSecureContext };
}

/**
 * Copies `text` to the clipboard. Resolves `true` if the browser says it was
 * copied, `false` otherwise.
 *
 * Never rejects: the caller is a keyboard shortcut with nothing useful to do
 * with an error, and a debug tool must never throw into the app.
 */
export async function copyText(text: string, host?: ClipboardHost): Promise<boolean> {
  try {
    // Resolved inside the try so a missing global also ends as `false`.
    const h = host ?? realClipboardHost();
    const clipboard = h.navigator.clipboard;
    if (h.isSecureContext && typeof clipboard?.writeText === 'function') {
      try {
        await clipboard.writeText(text);
        return true;
      } catch {
        // Permission denied or document not focused: the old path may still work.
      }
    }
    return copyWithExecCommand(text, h.document);
  } catch {
    return false;
  }
}

/**
 * The pre-Clipboard-API way: select the text in a temporary textarea and ask
 * the browser to copy the selection. Synchronous, so it still runs inside the
 * user gesture (key press) that the browser requires for a copy.
 */
function copyWithExecCommand(text: string, doc: ClipboardHost['document']): boolean {
  // select() moves focus to the textarea; remember where the user was.
  const previous = doc.activeElement;
  const textarea = doc.createElement('textarea');
  textarea.value = text;
  // readonly stops a mobile keyboard from popping up on select().
  textarea.readOnly = true;
  // Off-screen and invisible, but not display:none — hidden elements cannot
  // hold a selection.
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  try {
    doc.body.appendChild(textarea);
    textarea.select();
    return doc.execCommand('copy');
  } finally {
    textarea.remove();
    restoreFocus(previous);
  }
}

/**
 * Copying must not steal focus from an input the user was typing in.
 * Re-focusing an input also brings back its own caret / selection.
 */
function restoreFocus(previous: Element | null): void {
  if (previous && 'focus' in previous && typeof previous.focus === 'function') {
    try {
      previous.focus();
    } catch {
      // A failed re-focus must not turn a successful copy into a failure.
    }
  }
}
