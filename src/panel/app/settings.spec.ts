import { FakeStorage } from './fakes.spec';
import {
  createSettingsStore,
  defaultSettings,
  NO_CHIPS,
  PanelSettings,
  parseSettings,
  serializeSettings,
} from './settings';

describe('S-08 settings storage (FR-ACT-08, D-20, §6.8)', () => {
  const defaults = defaultSettings('bottom');
  const custom: PanelSettings = {
    theme: 'dark',
    dock: 'right',
    textSize: 'large',
    time: 'relative',
    height: 300,
    width: 640,
    tab: 'console',
    chips: {
      http: { status: ['4xx', '5xx'], type: ['xhr'] },
      ws: { direction: ['sent'], data: ['binary'] },
      console: { levels: ['error', 'warn'] },
    },
  };

  it('defaults: Auto, the given dock, Normal, Clock, default sizes, HTTP, no chips', () => {
    expect(defaults).toEqual({
      theme: 'auto',
      dock: 'bottom',
      textSize: 'normal',
      time: 'clock',
      height: null,
      width: null,
      tab: 'http',
      chips: NO_CHIPS,
    });
    expect(defaultSettings('right').dock).toBe('right');
  });

  it('round trip through storage', () => {
    const storage = new FakeStorage();
    const store = createSettingsStore(() => storage, 'k', defaults);
    store.save(custom);
    expect(createSettingsStore(() => storage, 'k', defaults).load()).toEqual(custom);
  });

  it('writes only when the stored text changes', () => {
    const storage = new FakeStorage();
    const store = createSettingsStore(() => storage, 'k', defaults);
    store.load();
    store.save(custom);
    store.save({ ...custom });
    expect(storage.writes).toBe(1);
  });

  it('corrupt or foreign values fall back field by field; unknown chips are dropped', () => {
    expect(parseSettings('{not json', defaults)).toEqual(defaults);
    expect(parseSettings('[1,2]', defaults)).toEqual(defaults);
    expect(parseSettings('null', defaults)).toEqual(defaults);
    const odd = parseSettings(
      JSON.stringify({
        theme: 'hotpink',
        dock: 'right',
        textSize: 12,
        height: -5,
        width: 1e9,
        tab: '__proto__',
        chips: { http: { status: ['5xx', 'evil', '5xx'], type: 'xhr' }, console: { levels: ['warn', 'error'] } },
      }),
      defaults,
    );
    expect(odd).toEqual({
      ...defaults,
      dock: 'right',
      chips: { ...NO_CHIPS, http: { status: ['5xx'], type: [] }, console: { levels: ['error', 'warn'] } },
    });
  });

  it('§6.8: only settings, size, dock, tab and chips are ever written — never search text or capture', () => {
    const sneaky = {
      ...custom,
      capture: 'off',
      chips: { ...custom.chips, http: { ...custom.chips.http, text: 'Bearer secret' } },
    } as unknown as PanelSettings;
    const text = serializeSettings(sneaky);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('capture');
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(
      ['chips', 'dock', 'height', 'tab', 'textSize', 'theme', 'time', 'v', 'width'].sort(),
    );
  });

  it('blocked storage: a throwing getter, getItem or setItem gives defaults and never throws', () => {
    const blocked = new FakeStorage();
    blocked.blocked = true;
    const viaGetter = createSettingsStore(
      () => {
        throw new DOMException('denied', 'SecurityError');
      },
      'k',
      defaults,
    );
    const viaCalls = createSettingsStore(() => blocked, 'k', defaults);
    expect(viaGetter.load()).toEqual(defaults);
    expect(viaCalls.load()).toEqual(defaults);
    expect(() => viaGetter.save(custom)).not.toThrow();
    expect(() => viaCalls.save(custom)).not.toThrow();
    expect(createSettingsStore(() => null, 'k', defaults).load()).toEqual(defaults);
  });

  it('storageKey false: storage is never touched', () => {
    const storage = jasmine.createSpy('storage').and.returnValue(new FakeStorage());
    const store = createSettingsStore(storage, false, defaults);
    expect(store.load()).toBe(defaults);
    store.save(custom);
    expect(storage).not.toHaveBeenCalled();
  });
});
