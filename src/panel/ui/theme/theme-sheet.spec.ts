import { CONTROLS_CSS } from './controls-css';
import { blendHex, rowHeightFor, TEXT_SIZE_DEFAULT, textSizeVars, THEME_CSS } from './theme-css';
import { createThemeSheet } from './theme-sheet';
import { TOKENS } from './tokens';

/** `#rrggbb` → the `rgb(r, g, b)` that getComputedStyle reports. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function allText(sheet: CSSStyleSheet): string {
  return Array.from(sheet.cssRules)
    .map((r) => r.cssText)
    .join('\n');
}

describe('theme (S04-02)', () => {
  let host: HTMLElement;
  let root: HTMLElement;
  let sheet: CSSStyleSheet;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    sheet = createThemeSheet(document);
    shadow.adoptedStyleSheets = [sheet];
    root = document.createElement('div');
    root.className = 'dcp-root';
    shadow.appendChild(root);
  });

  afterEach(() => host.remove());

  /** A child node in a given class, to read computed styles from. */
  function probe(className = ''): HTMLElement {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = 'x';
    root.appendChild(el);
    return el;
  }

  it('TOKENS has the same 20 names in both themes', () => {
    expect(Object.keys(TOKENS.dark).length).toBe(20);
    expect(Object.keys(TOKENS.light)).toEqual(Object.keys(TOKENS.dark));
  });

  it('is one constructed sheet holding the theme, the controls and the extra CSS, in that order', () => {
    const own = createThemeSheet(document, [
      '.dcp-row{height:var(--dcp-row-h)}',
      '.dcp-json-key{color:var(--dcp-json-key)}',
    ]);
    const text = allText(own);

    expect(own).toBeInstanceOf(CSSStyleSheet);
    expect(own.ownerNode).toBeNull();
    expect(text.indexOf('.dcp-root {')).toBe(0);
    expect(text.indexOf('.dcp-btn {')).toBeGreaterThan(0);
    expect(text.indexOf('.dcp-btn {')).toBeLessThan(text.indexOf('.dcp-row { height'));
    expect(text).toContain('.dcp-json-key');
    // Every rule parsed: nothing was dropped as invalid.
    expect(own.cssRules.length).toBeGreaterThan(40);
  });

  it('holds no rem, @font-face, @property, @import or url( (ISO-03, ISO-05)', () => {
    for (const text of [THEME_CSS, CONTROLS_CSS, allText(sheet)]) {
      expect(text).not.toMatch(/\d(?:\.\d+)?rem\b/);
      expect(text).not.toMatch(/@font-face|@property|@import|url\s*\(/i);
    }
  });

  for (const bad of [
    '.x{font-size:1rem}',
    '.x{font-size:0.75rem}',
    '@font-face{font-family:x}',
    '@import "x.css";',
    '@property --x{syntax:"*"}',
    '.x{background:url(x.png)}',
    '.x{color:color-mix(in srgb, red 8%, blue)}',
  ]) {
    it(`refuses extra CSS with ${JSON.stringify(bad)}`, () => {
      expect(() => createThemeSheet(document, [bad])).toThrowError(/may not contain/);
    });
  }

  it('needs a document with a window', () => {
    const detached = document.implementation.createHTMLDocument('x');
    expect(() => createThemeSheet(detached)).toThrowError(/window/);
  });

  it('data-theme switches every token (computed on a test node)', () => {
    const node = probe();
    for (const theme of ['dark', 'light'] as const) {
      root.setAttribute('data-theme', theme);
      const style = getComputedStyle(node);
      for (const [name, value] of Object.entries(TOKENS[theme])) {
        expect(style.getPropertyValue(`--dcp-${name}`).trim())
          .withContext(`${theme} --dcp-${name}`)
          .toBe(value);
      }
      expect(style.color).toBe(rgb(TOKENS[theme].text));
      expect(getComputedStyle(root).backgroundColor).toBe(rgb(TOKENS[theme].bg));
      expect(getComputedStyle(root).colorScheme).toBe(theme);
    }
    // Headless Chromium reports a light OS, so Auto alone would also paint the
    // light case above; check that data-theme="light" has its own rule too.
    const rule = Array.from(sheet.cssRules).find(
      (r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === '.dcp-root[data-theme="light"]',
    );
    expect(rule?.style.getPropertyValue('--dcp-text').trim()).toBe(TOKENS.light.text);
    expect(rule?.style.getPropertyValue('--dcp-bg').trim()).toBe(TOKENS.light.bg);
  });

  it('Auto (no data-theme) follows prefers-color-scheme, with no script', () => {
    root.removeAttribute('data-theme');
    const light = matchMedia('(prefers-color-scheme: light)').matches;
    expect(getComputedStyle(probe()).color).toBe(rgb(TOKENS[light ? 'light' : 'dark'].text));
    expect(THEME_CSS).toContain('@media (prefers-color-scheme:light){.dcp-root:not([data-theme="dark"])');
  });

  it('sets the inherited values on the root, in px and ltr (ISO-03)', () => {
    const style = getComputedStyle(root);
    expect(style.direction).toBe('ltr');
    expect(style.fontSize).toBe('12px');
    expect(style.fontWeight).toBe('400');
    expect(style.lineHeight).toBe('16.8px');
    expect(style.textAlign).toBe('left');
    expect(style.textTransform).toBe('none');
    expect(style.letterSpacing).toBe('normal');
    expect(style.fontFamily).toContain('system-ui');
    expect(style.visibility).toBe('visible');
  });

  /** The S-15 size table (spec.md › Sizes): n → ui, meta, row, control, bar, menu item, status bar, icon, badge, small icon. */
  const TABLE = [
    [10, 9, 18, 24, 32, 28, 22, 14, 16, 12],
    [11, 10, 20, 24, 32, 28, 22, 14, 16, 12],
    [12, 11, 22, 24, 32, 28, 22, 14, 16, 12],
    [14, 13, 26, 24, 32, 28, 22, 14, 16, 12],
    [16, 15, 30, 28, 36, 32, 24, 16, 18, 14],
    [20, 19, 38, 36, 44, 40, 28, 20, 22, 18],
  ] as const;

  it("FR-TXT-03, D-50: textSizeVars gives the S-15 table; up to 14 px every size is 2.3's", () => {
    for (const [n, meta, row, control, bar, menu, status, icon, badge, iconSm] of TABLE) {
      expect(textSizeVars(n))
        .withContext(`${n} px`)
        .toEqual({
          '--dcp-fs-ui': `${n}px`,
          '--dcp-fs-data': `${n}px`,
          '--dcp-fs-meta': `${meta}px`,
          '--dcp-row-h': `${row}px`,
          '--dcp-control-h': `${control}px`,
          '--dcp-bar-h': `${bar}px`,
          '--dcp-menu-item-h': `${menu}px`,
          '--dcp-status-h': `${status}px`,
          '--dcp-icon': `${icon}px`,
          '--dcp-badge-h': `${badge}px`,
          '--dcp-icon-sm': `${iconSm}px`,
        });
      expect(rowHeightFor(n)).withContext(`${n} px`).toBe(row);
    }
  });

  it('FR-TXT-03: out of range or not whole is clamped to 10…20 and rounded; not a number is 12', () => {
    expect(textSizeVars(9)).toEqual(textSizeVars(10));
    expect(textSizeVars(99)).toEqual(textSizeVars(20));
    expect(textSizeVars(12.6)).toEqual(textSizeVars(13));
    expect(textSizeVars(NaN)).toEqual(textSizeVars(12));
    expect(rowHeightFor(-1)).toBe(18);
    expect(TEXT_SIZE_DEFAULT).toBe(12);
  });

  it("FR-TXT-03: the sheet's defaults are the 12 px sizes; the properties on the root resize text, controls, icons and badges", () => {
    const meta = probe('dcp-meta');
    const data = probe('dcp-data');
    const btn = probe('dcp-btn');
    const badge = probe('dcp-badge');
    const icon = probe('dcp-icon');
    const read = (name: string): string => getComputedStyle(root).getPropertyValue(name).trim();
    for (const [name, value] of Object.entries(textSizeVars(12))) expect(read(name)).withContext(name).toBe(value);

    for (const [name, value] of Object.entries(textSizeVars(20))) root.style.setProperty(name, value);
    expect(getComputedStyle(root).fontSize).toBe('20px');
    expect(getComputedStyle(data).fontSize).toBe('20px');
    expect(getComputedStyle(meta).fontSize).toBe('19px');
    expect(getComputedStyle(btn).height).toBe('36px');
    expect(getComputedStyle(badge).height).toBe('22px');
    expect(getComputedStyle(icon).width).toBe('20px');
    expect(getComputedStyle(data).fontFamily).toContain('monospace');
  });

  it('badges: token colour on an opaque 12 % fill over --dcp-bg (HLD §5.4)', () => {
    const cases = [
      ['dcp-badge dcp-badge--redacted', 'text-muted'],
      ['dcp-badge dcp-badge--pending', 'text-muted'],
      ['dcp-badge dcp-badge--truncated', 'warning'],
    ] as const;
    for (const theme of ['dark', 'light'] as const) {
      root.setAttribute('data-theme', theme);
      for (const [className, token] of cases) {
        const style = getComputedStyle(probe(className));
        const t = TOKENS[theme];
        expect(style.color).withContext(`${theme} ${className}`).toBe(rgb(t[token]));
        expect(style.backgroundColor)
          .withContext(`${theme} ${className}`)
          .toBe(rgb(blendHex(t[token], t.bg, 0.12)));
      }
    }
    // Hand-checked: 12 % of #a9aeb8 over #1e1f22 (as scripts/contrast-check.mjs rounds).
    expect(blendHex('#a9aeb8', '#1e1f22', 0.12)).toBe('#2f3034');
  });

  it('defines no row-tint variables: 04b draws row tints itself (review S-04 #16)', () => {
    expect(THEME_CSS).not.toContain('--dcp-tint-');
  });

  it('dcp-match: match background, text colour (HLD §5.7)', () => {
    root.setAttribute('data-theme', 'dark');
    const style = getComputedStyle(probe('dcp-match'));
    expect(style.backgroundColor).toBe(rgb(TOKENS.dark['match-bg']));
    expect(style.color).toBe(rgb(TOKENS.dark.text));
  });

  it('a pressed dcp-btn (aria-pressed="true") looks pressed with this sheet alone: views need no frame CSS (HLD §5.7)', () => {
    root.setAttribute('data-theme', 'dark');
    const button = (pressed: boolean): CSSStyleDeclaration => {
      const el = document.createElement('button');
      el.className = 'dcp-btn';
      el.setAttribute('aria-pressed', String(pressed));
      root.appendChild(el);
      return getComputedStyle(el);
    };
    const on = button(true);
    const off = button(false);
    expect(on.backgroundColor).toBe(rgb(TOKENS.dark['bg-selected']));
    expect(on.borderTopColor).toBe(rgb(TOKENS.dark.accent));
    expect(off.backgroundColor).toBe(rgb(TOKENS.dark.bg));
  });

  it('focus: 2 px accent ring on :focus-visible only, 1 px outside; inset on tabs and rows (HLD §5.7)', () => {
    expect(THEME_CSS).toContain('.dcp-root :focus{outline:none}');
    expect(THEME_CSS).toContain('.dcp-root :focus-visible{outline:2px solid var(--dcp-accent);outline-offset:1px}');
    expect(THEME_CSS).toMatch(
      /\.dcp-root \.dcp-tab:focus-visible,\.dcp-root \.dcp-row:focus-visible,[^{]*\{outline-offset:-2px\}/,
    );
    const button = document.createElement('button');
    root.appendChild(button);
    button.disabled = true;
    expect(getComputedStyle(button).opacity).toBe('0.5');
  });

  it('maps tokens to system colours in forced-colours mode (HLD §5.4)', () => {
    const forced = Array.from(sheet.cssRules).filter(
      (r): r is CSSMediaRule => r instanceof CSSMediaRule && r.media.mediaText.includes('forced-colors'),
    );
    const text = forced.map((r) => r.cssText).join('\n');
    expect(forced.length).toBeGreaterThan(0);
    for (const colour of ['Canvas', 'CanvasText', 'GrayText', 'Highlight', 'HighlightText', 'ButtonText', 'Mark']) {
      // The CSSOM lower-cases system colours outside custom properties.
      expect(text)
        .withContext(colour)
        .toMatch(new RegExp(`\\b${colour}\\b`, 'i'));
    }
    expect(text).toContain('forced-color-adjust: none');
  });

  it('turns motion off under prefers-reduced-motion', () => {
    const motion = Array.from(sheet.cssRules).find(
      (r): r is CSSMediaRule => r instanceof CSSMediaRule && r.media.mediaText.includes('prefers-reduced-motion'),
    );
    const style = (motion?.cssRules[0] as CSSStyleRule).style;
    for (const name of ['transition-property', 'animation-name']) {
      expect(style.getPropertyValue(name)).withContext(name).toBe('none');
      expect(style.getPropertyPriority(name)).withContext(name).toBe('important');
    }
  });

  it('every theme rule is scoped to .dcp-root or a dcp- class (ISO-05)', () => {
    const selectors: string[] = [];
    const walk = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) selectors.push(...rule.selectorText.split(','));
        else if (rule instanceof CSSMediaRule) walk(rule.cssRules);
      }
    };
    walk(sheet.cssRules);
    expect(selectors.length).toBeGreaterThan(40);
    for (const selector of selectors) expect(selector.trim()).toMatch(/^\.dcp-/);
  });
});
