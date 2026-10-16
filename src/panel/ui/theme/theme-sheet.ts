import { CONTROLS_CSS } from './controls-css';
import { THEME_CSS } from './theme-css';

/**
 * CSS the panel must never ship (ISO-03, ISO-05): `rem` follows the host's
 * root font size; `@font-face`, `@property` and `@import` reach outside the
 * shadow root (or the network); `url(` could fetch; `color-mix(` needs
 * Chromium 111, and 90–110 drop the whole declaration.
 */
const FORBIDDEN_CSS = /\d(?:\.\d+)?rem\b|@font-face|@property|@import|url\s*\(|color-mix\s*\(/i;

/**
 * Builds the panel's one stylesheet (ISO-04: `adoptedStyleSheets`, no
 * `<style>` element) from the theme, the controls and the other blocks' CSS
 * (`VIRTUAL_LIST_CSS`, `JSON_VIEWER_CSS`) passed as `extraCss`. A constructed
 * sheet must come from the panel's own window, so it takes the document.
 * Throws if any part holds forbidden CSS — that is a bug in the panel's code,
 * caught by its tests.
 */
export function createThemeSheet(doc: Document, extraCss: readonly string[] = []): CSSStyleSheet {
  const view = doc.defaultView;
  if (!view) throw new Error('createThemeSheet needs a document that has a window');
  const parts = [THEME_CSS, CONTROLS_CSS, ...extraCss];
  for (const part of parts) {
    const bad = FORBIDDEN_CSS.exec(part);
    if (bad) throw new Error(`Panel CSS may not contain "${bad[0]}" (ISO-03, ISO-05)`);
  }
  const sheet = new view.CSSStyleSheet();
  sheet.replaceSync(parts.join('\n'));
  return sheet;
}
