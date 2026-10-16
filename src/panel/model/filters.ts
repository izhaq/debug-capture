/** A half-open range `[start, end)` of UTF-16 indexes into a string. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Lower-cases `text` without changing its length, so an index into the
 * result is an index into `text`. The few characters whose lower case has
 * another length (`İ` → `i̇`) stay as they are; plain `toLowerCase()` would
 * shift every highlight after them.
 */
export function foldCase(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    const l = c.toLowerCase();
    out += l.length === 1 ? l : c;
  }
  return out;
}

/**
 * Where `query` occurs in `text`, case-insensitive, left to right, not
 * overlapping — for the search highlight (`dcp-match`, §4.5). Empty query →
 * no ranges.
 */
export function matchRanges(text: string, query: string): readonly TextRange[] {
  if (query === '') return [];
  const hay = foldCase(text);
  const needle = foldCase(query);
  const ranges: TextRange[] = [];
  let from = hay.indexOf(needle);
  while (from !== -1) {
    ranges.push({ start: from, end: from + needle.length });
    from = hay.indexOf(needle, from + needle.length);
  }
  return ranges;
}

/**
 * Adds `chip` to a chip group, or removes it if it is there — the click on a
 * chip. "All" is not a chip: set the group to `[]`.
 */
export function toggleChip<T>(chips: readonly T[], chip: T): readonly T[] {
  return chips.indexOf(chip) === -1 ? [...chips, chip] : chips.filter((c) => c !== chip);
}
