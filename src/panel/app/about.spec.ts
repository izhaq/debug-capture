import { createDom, DEFAULT_SHORTCUTS } from '../views';
import { ABOUT_PANEL_KEYS, AboutInfo, createAbout, formatChord } from './about';

/** S-13b (S13-16, FR-BG-09, D-42): Settings › About — the version and every shortcut in use. */
describe('About (createAbout)', () => {
  const dom = createDom(document);
  const info = (extra: Partial<AboutInfo> = {}): AboutInfo => ({
    version: '9.8.7-test',
    toggle: 'ctrl+alt+shift+p',
    activation: 'ctrl+alt+shift+a',
    capture: DEFAULT_SHORTCUTS,
    ...extra,
  });
  /** `[keys, action]` per row, in order. */
  const rows = (about: HTMLElement): string[][] =>
    Array.from(about.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.children).map((cell) => (cell.textContent ?? '').trim()),
    );

  it('formatChord: each part capitalised, joined with +; false, null and empty read "off"', () => {
    expect(formatChord('ctrl+alt+shift+p')).toBe('Ctrl+Alt+Shift+P');
    expect(formatChord(' CTRL + Alt + shift + 9 ')).toBe('Ctrl+Alt+Shift+9');
    expect(formatChord('meta+k')).toBe('Meta+K');
    expect(formatChord(false)).toBe('off');
    expect(formatChord(null)).toBe('off');
    expect(formatChord('')).toBe('off');
  });

  it('shows the version, then every background chord with the chord in use, then the in-panel keys', () => {
    const about = createAbout(dom, info());

    expect(about.querySelector('h3')?.textContent).toBe('About');
    expect(about.textContent).toContain('debug-capture 9.8.7-test');
    expect(rows(about)).toEqual([
      ['Ctrl+Alt+Shift+A', 'Turn the tool on (remembered); again: off for good'],
      ['Ctrl+Alt+Shift+P', 'Open / close the panel'],
      ['Ctrl+Alt+Shift+D', 'Download the capture (JSON file)'],
      ['Ctrl+Alt+Shift+C', 'Copy the capture (JSON) to the clipboard'],
      ['Ctrl+Alt+Shift+X', 'Clear the capture'],
      ['Ctrl+Alt+Shift+S', 'Capture on / off'],
      ['Ctrl+Alt+Shift+M', 'Add the pre-set note'],
      ...ABOUT_PANEL_KEYS.map(([keys, action]) => [keys, action]),
    ]);
  });

  it('lists the in-panel keys of HLD §4.12', () => {
    expect(ABOUT_PANEL_KEYS.map(([keys]) => keys)).toEqual([
      'Escape',
      '↑ ↓ Home End PageUp PageDown',
      'Enter',
      'Ctrl+F',
      'Alt+1 / Alt+2',
      '← →',
      '← → Enter Space',
    ]);
  });

  it('shows custom chords; a disabled one reads "off"; no activation row without activation', () => {
    const about = createAbout(
      dom,
      info({ toggle: false, activation: false, capture: { ...DEFAULT_SHORTCUTS, note: 'ctrl+alt+shift+9' } }),
    );
    const background = rows(about).slice(0, 6);
    expect(background[0]).toEqual(['off', 'Open / close the panel']);
    expect(background[5]).toEqual(['Ctrl+Alt+Shift+9', 'Add the pre-set note']);
    expect(rows(about).some(([, action]) => action.startsWith('Turn the tool on'))).toBeFalse();
  });

  it('capture shortcuts: false (null) — every capture chord reads "off"', () => {
    const about = createAbout(dom, info({ capture: null }));
    expect(
      rows(about)
        .slice(2, 7)
        .map(([keys]) => keys),
    ).toEqual(['off', 'off', 'off', 'off', 'off']);
  });

  it('is a keyboard-scrollable region, built from text only', () => {
    const about = createAbout(dom, info({ version: '<img src=x onerror=alert(1)>' }));
    expect(about.getAttribute('role')).toBe('region');
    expect(about.getAttribute('aria-label')).toBe('About');
    expect(about.tabIndex).toBe(0);
    expect(about.querySelector('img')).toBeNull();
    expect(about.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
