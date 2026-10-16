import { Dom } from './dom';
import { createIcon, IconName } from './icons';

/** The three badges of HLD §5.4. */
export type BadgeKind = 'redacted' | 'truncated' | 'pending';

const BADGE_ICONS: Readonly<Record<BadgeKind, IconName>> = {
  redacted: 'redacted',
  truncated: 'truncated',
  pending: 'pending',
};

/**
 * A badge: icon and word on an opaque tint (`dcp-badge dcp-badge--<kind>`).
 * `text` defaults to the kind (e.g. `truncated 1,204 chars` is the caller's).
 * It has no listeners, so there is nothing to destroy.
 */
export function createBadge(dom: Dom, kind: BadgeKind, text: string = kind): HTMLSpanElement {
  return dom.el('span', { className: `dcp-badge dcp-badge--${kind}` }, [createIcon(dom, BADGE_ICONS[kind]), text]);
}
