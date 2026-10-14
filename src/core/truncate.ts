/**
 * Caps `text` at `max` characters. The marker says how much was cut, so a
 * reader of the capture file never mistakes a truncated body for the whole one.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…[truncated ${text.length - max} chars]`;
}

/**
 * `truncate`, but `redactKept` runs on the kept part only, before the marker
 * is added. For redactions that work on a prefix as well as on the whole
 * (URL and form parameters: a parameter cut by truncation is gone anyway),
 * this bounds their cost by `max` instead of by the input — a 10 MB form body
 * costs no more than a short one.
 */
export function truncateThen(text: string, max: number, redactKept: (kept: string) => string): string {
  if (text.length <= max) {
    return redactKept(text);
  }
  return `${redactKept(text.slice(0, max))}…[truncated ${text.length - max} chars]`;
}
