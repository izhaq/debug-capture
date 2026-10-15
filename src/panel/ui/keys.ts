/**
 * The next index for a roving-focus key (← → ↑ ↓ Home End) in a list of
 * `count` items, wrapping at the ends; `null` when `key` is not one of them
 * for this orientation. Shared by tabs, chips and menus.
 */
export function rovingIndex(
  key: string,
  current: number,
  count: number,
  orientation: 'horizontal' | 'vertical',
): number | null {
  const [back, forward] = orientation === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  switch (key) {
    case back:
      return (current - 1 + count) % count;
    case forward:
      return (current + 1) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
