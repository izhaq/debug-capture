/**
 * P2 panel UI barrel — DOM building blocks (safe element builder, virtual
 * list, JSON viewer, split pane, tabs, theme). May import only the P1 model
 * barrel and re-exports it; touches only the `document` passed in. No packages.
 */
export * from '../model';

export { createBadge } from './badge';
export type { BadgeKind } from './badge';
export { createButton } from './button';
export type { ButtonControl, ButtonOptions } from './button';
export { createChipGroup } from './chip-group';
export type { ChipGroupControl, ChipGroupOptions, ChipItem } from './chip-group';
export { createDom, createListeners, setAttr, setAttrs, setStyle, UnsafeDomError } from './dom';
export type {
  AttrValue,
  Attrs,
  Child,
  Dom,
  ElementOptions,
  ErrorReporter,
  Listeners,
  SafeSvgTag,
  SafeTag,
  StyleMap,
} from './dom';
export { createEmptyState } from './empty-state';
export type { EmptyStateControl, EmptyStateOptions } from './empty-state';
export { highlightText } from './highlight';
export { createIcon, ICON_NAMES } from './icons';
export type { IconName, IconOptions } from './icons';
export { createMenu, createPopover } from './popover';
export type { MenuItem, MenuOptions, PopoverControl, PopoverOptions, PopupOptions } from './popover';
export { createSearchBox, SEARCH_DEBOUNCE_MS } from './search-box';
export type { Schedule, SearchBoxControl, SearchBoxOptions } from './search-box';
export { createSplitPane } from './split-pane';
export type { SplitDirection, SplitPaneControl, SplitPaneOptions } from './split-pane';
export { createTabs } from './tabs';
export type { TabItem, TabsControl, TabsOptions } from './tabs';
export * from './theme';
