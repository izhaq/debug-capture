/**
 * The safe element builder (S04-01, NFR-SEC-01, ISO-04). Every node the panel
 * makes goes through here, so one file decides what can reach the DOM:
 *
 * - strings only ever become text nodes, never markup;
 * - tags come from a short allow-list (no `script`, `iframe`, `style`, `a`…);
 * - attribute names come from allow-lists (HTML and SVG), so nothing that
 *   runs code, loads, navigates or styles (`on*`, `href`, `src`, `srcdoc`,
 *   `style`, `part`, SVG `cursor` / `mask` / `clip-path`…) can be set; text
 *   attributes (`title`, `aria-*`, `data-*`) may hold any captured text;
 * - SVG `fill` / `stroke` take only `currentColor`, `none` or a hex colour
 *   (a `url(…)` paint would fetch);
 * - inline styles go through the CSSOM one property at a time, and a value
 *   that could fetch (`url(`, `image-set(`…) is refused;
 * - events are attached only as listeners (`createListeners`), so every
 *   control can remove all of them on `destroy()`.
 *
 * A refusal throws `UnsafeDomError`: it is a programming error in the panel,
 * never a reaction to captured data (which arrives only as text).
 */

/** A value for `setAttr`: `true` sets an empty attribute; `false`, `null` and `undefined` remove it. */
export type AttrValue = string | number | boolean | null | undefined;

/** Attributes by name. */
export type Attrs = Readonly<Record<string, AttrValue>>;

/** Inline style properties by CSS name (`min-width`, `--dcp-x`); set through the CSSOM. */
export type StyleMap = Readonly<Record<string, string>>;

/** A child for `Dom.el`: nodes as they are, strings and numbers as text; `null`, `undefined` and `false` are skipped. */
export type Child = Node | string | number | null | undefined | false;

/** What `Dom.el` sets on a new element besides its children. */
export interface ElementOptions {
  /** Space-separated class names. */
  readonly className?: string;
  readonly attrs?: Attrs;
  readonly style?: StyleMap;
}

/** The HTML tags the panel may create. Anything that loads, runs or embeds is left out. */
export type SafeTag =
  | 'div'
  | 'span'
  | 'button'
  | 'input'
  | 'label'
  | 'select'
  | 'option'
  | 'textarea'
  | 'ul'
  | 'ol'
  | 'li'
  | 'dl'
  | 'dt'
  | 'dd'
  | 'table'
  | 'thead'
  | 'tbody'
  | 'tr'
  | 'th'
  | 'td'
  | 'pre'
  | 'code'
  | 'mark'
  | 'kbd'
  | 'strong'
  | 'em'
  | 'small'
  | 'p'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'section'
  | 'header'
  | 'footer'
  | 'fieldset'
  | 'legend'
  | 'hr'
  | 'br';

/** The SVG tags icons may use: shapes only (no `use`, `a`, `foreignObject`, `animate`, `script`). */
export type SafeSvgTag = 'svg' | 'g' | 'path' | 'circle' | 'rect' | 'line' | 'polyline' | 'polygon' | 'ellipse';

const SAFE_TAGS: ReadonlySet<string> = new Set<SafeTag>([
  'div',
  'span',
  'button',
  'input',
  'label',
  'select',
  'option',
  'textarea',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'pre',
  'code',
  'mark',
  'kbd',
  'strong',
  'em',
  'small',
  'p',
  'h2',
  'h3',
  'h4',
  'section',
  'header',
  'footer',
  'fieldset',
  'legend',
  'hr',
  'br',
]);

const SAFE_SVG_TAGS: ReadonlySet<string> = new Set<SafeSvgTag>([
  'svg',
  'g',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
]);

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * HTML attributes the panel may set. Anything else — `on*`, `href`, `src`,
 * `srcdoc`, `style`, `part` / `exportparts` (host `::part()` CSS would reach
 * in, ISO-05), `autofocus` (ISO-16), `popovertarget`, `contenteditable` — is
 * refused until someone adds it here on purpose. HTML names are matched in
 * lower case, as the browser stores them.
 */
const HTML_ATTRIBUTES: ReadonlySet<string> = new Set([
  'class',
  'id',
  'role',
  'title',
  'lang',
  'dir',
  'hidden',
  'inert',
  'tabindex',
  'type',
  'name',
  'value',
  'placeholder',
  'autocomplete',
  'spellcheck',
  'disabled',
  'readonly',
  'checked',
  'selected',
  'for',
  'maxlength',
  'colspan',
  'rowspan',
]);

/** SVG attributes icons may use: geometry and plain paint only, matched case-sensitively (`viewBox`). */
const SVG_ATTRIBUTES: ReadonlySet<string> = new Set([
  'class',
  'role',
  'focusable',
  'viewBox',
  'width',
  'height',
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'transform',
  'opacity',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
]);

/** `aria-*` and `data-*`, lower case: text only, allowed on both. */
const TEXT_ATTRIBUTE = /^(?:aria|data)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The only SVG paints: no `url(…)` (it fetches), no keywords to keep it simple. */
const SVG_PAINT = /^(?:currentColor|none|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/;

/** A CSS property name, or a custom property. */
const STYLE_NAME = /^(?:--[a-zA-Z0-9-]+|[a-z][a-z-]*)$/;

/** Style values that can fetch or run something; a backslash could spell any of them as an escape. */
const FORBIDDEN_STYLE_VALUE = /url\s*\(|image-set\s*\(|image\s*\(|expression\s*\(|@import|javascript:|\\/i;

/** Thrown when the panel's own code asks the builder for something unsafe. */
export class UnsafeDomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeDomError';
  }
}

/** Builds elements for one document (the host page's; the panel reads no globals). */
export interface Dom {
  readonly document: Document;
  /** A new HTML element from the allow-list, with checked attributes and styles; strings in `children` become text. */
  el<K extends SafeTag>(tag: K, options?: ElementOptions | null, children?: readonly Child[]): HTMLElementTagNameMap[K];
  /** A new SVG element from the allow-list, with checked attributes. */
  svg<K extends SafeSvgTag>(tag: K, attrs?: Attrs | null, children?: readonly Node[]): SVGElementTagNameMap[K];
  /** A text node: the only way a string enters the DOM. */
  text(value: string): Text;
  /** Appends children as `el` does (strings become text). */
  append(parent: Node, children: readonly Child[]): void;
}

/** The builder for `doc`. */
export function createDom(doc: Document): Dom {
  const append = (parent: Node, children: readonly Child[]): void => {
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      if (typeof child === 'string' || typeof child === 'number') {
        parent.appendChild(doc.createTextNode(String(child)));
      } else if (isNode(child)) {
        parent.appendChild(child);
      } else {
        throw new UnsafeDomError('A child must be a node, a string or a number');
      }
    }
  };
  return {
    document: doc,
    el(tag, options, children) {
      if (!SAFE_TAGS.has(tag)) throw new UnsafeDomError(`Tag <${String(tag)}> is not allowed`);
      const element = doc.createElement(tag);
      applyOptions(element, options);
      if (children) append(element, children);
      return element;
    },
    svg(tag, attrs, children) {
      if (!SAFE_SVG_TAGS.has(tag)) throw new UnsafeDomError(`SVG tag <${String(tag)}> is not allowed`);
      const element = doc.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[typeof tag];
      if (attrs) setAttrs(element, attrs);
      if (children) append(element, children);
      return element;
    },
    text: (value) => doc.createTextNode(String(value)),
    append,
  };
}

/** Sets one attribute after the safety checks (see the file comment). */
export function setAttr(element: Element, name: string, value: AttrValue): void {
  const svg = element.namespaceURI === SVG_NS;
  const allowed = TEXT_ATTRIBUTE.test(name) || (svg ? SVG_ATTRIBUTES : HTML_ATTRIBUTES).has(name);
  if (!allowed) {
    const hint = /^on/i.test(name) ? '; use a listener' : '';
    throw new UnsafeDomError(`Attribute "${name}" is not allowed on <${element.localName}>${hint}`);
  }
  if (value === false || value === null || value === undefined) {
    element.removeAttribute(name);
    return;
  }
  const text = value === true ? '' : String(value);
  if (svg && (name === 'fill' || name === 'stroke') && !SVG_PAINT.test(text)) {
    throw new UnsafeDomError(`SVG paint "${text}" is not allowed: use currentColor, none or a hex colour`);
  }
  element.setAttribute(name, text);
}

/** Sets several attributes with `setAttr`. */
export function setAttrs(element: Element, attrs: Attrs): void {
  for (const name of Object.keys(attrs)) setAttr(element, name, attrs[name]);
}

/** Sets (or, with `null`, removes) one inline style property through the CSSOM. */
export function setStyle(element: HTMLElement | SVGElement, name: string, value: string | null): void {
  if (!STYLE_NAME.test(name)) throw new UnsafeDomError(`Style property "${name}" is not allowed`);
  if (value === null) {
    element.style.removeProperty(name);
    return;
  }
  if (FORBIDDEN_STYLE_VALUE.test(value)) throw new UnsafeDomError(`Style value for "${name}" is not allowed`);
  element.style.setProperty(name, value);
}

function applyOptions(element: HTMLElement, options: ElementOptions | null | undefined): void {
  if (!options) return;
  if (options.className) element.className = options.className;
  if (options.attrs) setAttrs(element, options.attrs);
  if (options.style) {
    for (const name of Object.keys(options.style)) setStyle(element, name, options.style[name] ?? null);
  }
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).nodeType === 'number';
}

/** Receives an error thrown by a callback, so the panel can count it instead of letting it reach the page. */
export type ErrorReporter = (error: unknown) => void;

/** Every listener a control adds, so `destroy()` can remove them all. */
export interface Listeners {
  /**
   * Adds a listener. The handler runs inside `try/catch` (ISO-12): an error
   * goes to the reporter, never to the host page. Returns a remover.
   */
  on<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): () => void;
  /** Removes every listener still attached. */
  removeAll(): void;
  /** How many listeners are attached now. */
  readonly count: number;
}

/** A listener set; `onError` receives what a handler throws (default: dropped). */
export function createListeners(onError?: ErrorReporter): Listeners {
  const attached = new Set<() => void>();
  return {
    on(target, type, handler, options) {
      const listener = (event: Event): void => {
        try {
          handler(event as HTMLElementEventMap[typeof type]);
        } catch (error) {
          report(onError, error);
        }
      };
      target.addEventListener(type, listener, options);
      const remove = (): void => {
        if (attached.delete(remove)) target.removeEventListener(type, listener, options);
      };
      attached.add(remove);
      return remove;
    },
    removeAll() {
      for (const remove of [...attached]) remove();
    },
    get count() {
      return attached.size;
    },
  };
}

/** Calls the reporter, which must never throw back into a handler. */
export function report(onError: ErrorReporter | undefined, error: unknown): void {
  try {
    onError?.(error);
  } catch {
    // The reporter itself failed; nothing safer is left to do.
  }
}
