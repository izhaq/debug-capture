import { Dom } from './dom';

/**
 * Most `<mark>`s one call makes: a 200 kB body matching one letter would
 * otherwise become 100,000 nodes (ISO-10). Matches past it stay plain text.
 */
export const HIGHLIGHT_MAX_MARKS = 100;

/**
 * `text` as text nodes, with each case-insensitive match of `query` wrapped
 * in `<mark class="dcp-match">` (HLD §4.5, §5.7), up to
 * `HIGHLIGHT_MAX_MARKS`. The text is never parsed: a match is found by index
 * and both sides are created as text nodes. Returns a fragment to append to a
 * cell.
 */
export function highlightText(dom: Dom, text: string, query: string): DocumentFragment {
  const fragment = dom.document.createDocumentFragment();
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  // Lower-casing can change a string's length (e.g. "İ"); then indexes would
  // not line up with the original, so show it unmarked rather than wrong.
  if (needle === '' || haystack.length !== text.length || needle.length !== query.length) {
    fragment.appendChild(dom.text(text));
    return fragment;
  }
  let from = 0;
  let marks = 0;
  for (let at = haystack.indexOf(needle); at >= 0 && marks < HIGHLIGHT_MAX_MARKS; at = haystack.indexOf(needle, from)) {
    if (at > from) fragment.appendChild(dom.text(text.slice(from, at)));
    fragment.appendChild(dom.el('mark', { className: 'dcp-match' }, [text.slice(at, at + needle.length)]));
    from = at + needle.length;
    marks++;
  }
  if (from < text.length) fragment.appendChild(dom.text(text.slice(from)));
  return fragment;
}
