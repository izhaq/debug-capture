type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

const MODIFIERS: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'meta'];

type KeyTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Turns `'ctrl+alt+shift+d'` into a matcher, or `null` when the spec is not
 * a chord we understand (so a typo disables one shortcut instead of
 * throwing at install).
 *
 * Matches on `KeyboardEvent.code` — the physical key — so the shortcut is
 * the same on every keyboard layout, and Alt+letter combinations that type
 * a special character on macOS still match. All four modifiers are compared
 * exactly: `ctrl+alt+shift+d` must not also fire on `ctrl+shift+d`, which
 * belongs to the browser.
 */
export function parseShortcut(spec: string): ((event: KeyboardEvent) => boolean) | null {
  if (typeof spec !== 'string') {
    return null;
  }
  const wanted = new Set<Modifier>();
  let code: string | null = null;
  for (const raw of spec.toLowerCase().split('+')) {
    const part = raw.trim();
    if ((MODIFIERS as readonly string[]).includes(part)) {
      const modifier = part as Modifier;
      if (wanted.has(modifier)) return null;
      wanted.add(modifier);
    } else if (code === null && /^[a-z]$/.test(part)) {
      code = `Key${part.toUpperCase()}`;
    } else if (code === null && /^[0-9]$/.test(part)) {
      code = `Digit${part}`;
    } else {
      return null;
    }
  }
  if (code === null) {
    return null;
  }
  const key = code;
  return (event) =>
    event.code === key &&
    event.ctrlKey === wanted.has('ctrl') &&
    event.altKey === wanted.has('alt') &&
    event.shiftKey === wanted.has('shift') &&
    event.metaKey === wanted.has('meta');
}

/**
 * One `keydown` listener for every binding; returns the function that
 * removes it (idempotent). Invalid specs are skipped.
 *
 * A matched chord is `preventDefault()`ed so the browser does not act on it
 * too. The action runs guarded: a broken export must not turn a key press
 * into an uncaught error on the page.
 */
export function bindShortcuts(
  target: KeyTarget,
  bindings: readonly (readonly [spec: string, action: () => void])[],
): () => void {
  const parsed: Array<{ matches: (event: KeyboardEvent) => boolean; action: () => void }> = [];
  for (const [spec, action] of bindings) {
    const matches = parseShortcut(spec);
    if (matches) parsed.push({ matches, action });
  }

  const onKeyDown = (event: Event): void => {
    if (!isKeyboardEvent(event)) return;
    for (const { matches, action } of parsed) {
      if (!matches(event)) continue;
      event.preventDefault();
      try {
        action();
      } catch {
        // Swallowed on purpose — see above.
      }
      return;
    }
  };

  target.addEventListener('keydown', onKeyDown);
  let bound = true;
  return () => {
    if (!bound) return;
    bound = false;
    target.removeEventListener('keydown', onKeyDown);
  };
}

/** Duck-typed rather than `instanceof`, so the target may live in another realm (an iframe). */
function isKeyboardEvent(event: Event): event is KeyboardEvent {
  return typeof (event as Partial<KeyboardEvent>).code === 'string';
}
