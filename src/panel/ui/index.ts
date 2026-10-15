/**
 * P2 panel UI barrel — DOM building blocks (safe element builder, virtual
 * list, JSON viewer, split pane, tabs, theme). May import only the P1 model
 * barrel and re-exports it; touches only the `document` passed in. No packages.
 */
export * from '../model';

export { createBadge } from './badge';
export type { BadgeKind } from './badge';
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
export { highlightText } from './highlight';
export { createIcon, ICON_NAMES } from './icons';
export type { IconName, IconOptions } from './icons';
