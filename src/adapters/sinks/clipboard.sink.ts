/**
 * Clipboard sink — puts text on the clipboard, for pasting a capture into a
 * ticket or chat when saving a file is awkward.
 *
 * `navigator.clipboard` exists only in secure contexts (HTTPS or localhost).
 * The air-gapped intranet this ships to is usually served over plain HTTP, so
 * there the `execCommand('copy')` fallback below is the normal path, not an
 * edge case.
 */
import { SinkOptions } from '../../core';

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
 *
 * `options.root` (C-5): where the fallback's textarea goes instead of
 * `<body>` — the panel passes its shadow root, so copying from the panel adds
 * no node to the host page (`ISO-04`).
 */
export async function copyText(text: string, host?: ClipboardHost, options?: SinkOptions): Promise<boolean> {
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
    return copyWithExecCommand(text, h.document, options?.root);
  } catch {
    return false;
  }
}

/**
 * The pre-Clipboard-API way: select the text in a temporary textarea and ask
 * the browser to copy the selection. Synchronous, so it still runs inside the
 * user gesture (key press) that the browser requires for a copy.
 */
function copyWithExecCommand(
  text: string,
  doc: ClipboardHost['document'],
  root: SinkOptions['root'] | undefined,
): boolean {
  // select() moves focus to the textarea; remember where the user was.
  const previous = focusedElement(doc, root);
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
    (root ?? doc.body).appendChild(textarea);
    textarea.select();
    return doc.execCommand('copy');
  } finally {
    textarea.remove();
    restoreFocus(previous);
  }
}

/**
 * The element to hand focus back to. When the user was typing inside the
 * root's shadow tree, `document.activeElement` is only the shadow host, and
 * re-focusing that would lose the input; the shadow root itself knows the
 * real element (also for a closed root, which the document cannot see into).
 */
function focusedElement(doc: ClipboardHost['document'], root: SinkOptions['root'] | undefined): Element | null {
  const rootNode = root && isNode(root) ? root.getRootNode() : null;
  if (rootNode && isShadowRoot(rootNode) && rootNode.activeElement) {
    return rootNode.activeElement;
  }
  return doc.activeElement;
}

function isNode(value: object): value is Node {
  return 'getRootNode' in value && typeof value.getRootNode === 'function';
}

/** Structural, not `instanceof`: the root may come from another document or realm. */
function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === DOCUMENT_FRAGMENT_NODE && 'activeElement' in node && 'host' in node;
}

/** `Node.DOCUMENT_FRAGMENT_NODE`, inlined so no global is read. */
const DOCUMENT_FRAGMENT_NODE = 11;

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
