import { bindShortcuts, parseShortcut } from './shortcuts';

interface Chord {
  code: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

function keydown({ code, ctrl = false, alt = false, shift = false, meta = false }: Chord): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    code,
    ctrlKey: ctrl,
    altKey: alt,
    shiftKey: shift,
    metaKey: meta,
    cancelable: true,
  });
}

describe('parseShortcut', () => {
  it('parses letters and digits in any modifier order', () => {
    const letter = parseShortcut('Shift+CTRL+alt+d');
    const digit = parseShortcut('meta+1');

    expect(letter).not.toBeNull();
    expect(letter?.(keydown({ code: 'KeyD', ctrl: true, alt: true, shift: true }))).toBeTrue();
    expect(
      parseShortcut(' ctrl + alt + shift + d ')?.(keydown({ code: 'KeyD', ctrl: true, alt: true, shift: true })),
    ).toBeTrue();
    expect(digit?.(keydown({ code: 'Digit1', meta: true }))).toBeTrue();
    expect(parseShortcut('d')?.(keydown({ code: 'KeyD' }))).toBeTrue();
  });

  it('rejects malformed specs', () => {
    for (const spec of [
      '',
      'ctrl',
      'ctrl+',
      'ctrl+alt',
      'ctrl+dd',
      'ctrl+d+e',
      'ctrl+ctrl+d',
      'hyper+d',
      'ctrl+f1',
      'ctrl+-',
    ]) {
      expect(parseShortcut(spec)).withContext(spec).toBeNull();
    }
  });

  it('matches exact modifiers only', () => {
    const matches = parseShortcut('ctrl+alt+shift+d');

    expect(matches?.(keydown({ code: 'KeyD', ctrl: true, shift: true }))).toBeFalse();
    expect(matches?.(keydown({ code: 'KeyD', ctrl: true, alt: true, shift: true, meta: true }))).toBeFalse();
    expect(matches?.(keydown({ code: 'KeyC', ctrl: true, alt: true, shift: true }))).toBeFalse();
    expect(matches?.(keydown({ code: 'KeyD', ctrl: true, alt: true, shift: true }))).toBeTrue();
  });
});

describe('bindShortcuts', () => {
  const chord: Chord = { code: 'KeyD', ctrl: true, alt: true, shift: true };

  it('runs the action and prevents default on match', () => {
    const target = new EventTarget();
    const action = jasmine.createSpy('action');
    const other = jasmine.createSpy('other');
    bindShortcuts(target, [
      ['ctrl+alt+shift+d', action],
      ['ctrl+alt+shift+c', other],
    ]);

    const miss = keydown({ code: 'KeyD', ctrl: true });
    target.dispatchEvent(miss);
    expect(action).not.toHaveBeenCalled();
    expect(miss.defaultPrevented).toBeFalse();

    const hit = keydown(chord);
    target.dispatchEvent(hit);
    expect(action).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(hit.defaultPrevented).toBeTrue();
  });

  it('skips invalid specs and binds the rest', () => {
    const target = new EventTarget();
    const action = jasmine.createSpy('action');
    bindShortcuts(target, [
      ['not a shortcut', jasmine.createSpy('never')],
      ['ctrl+alt+shift+d', action],
    ]);

    target.dispatchEvent(keydown(chord));

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing action', () => {
    const target = new EventTarget();
    const next = jasmine.createSpy('next');
    bindShortcuts(target, [
      [
        'ctrl+alt+shift+d',
        () => {
          throw new Error('broken action');
        },
      ],
    ]);
    target.addEventListener('keydown', next);

    const event = keydown(chord);
    expect(() => target.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBeTrue();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('unbind removes the listener', () => {
    const target = jasmine.createSpyObj<Pick<EventTarget, 'addEventListener' | 'removeEventListener'>>('target', [
      'addEventListener',
      'removeEventListener',
    ]);
    const unbind = bindShortcuts(target, [['ctrl+alt+shift+d', () => undefined]]);

    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    const [type, listener] = target.addEventListener.calls.mostRecent().args;

    unbind();
    unbind();

    expect(target.removeEventListener).toHaveBeenCalledOnceWith(type, listener);
  });

  it('a removed listener no longer fires', () => {
    const target = new EventTarget();
    const action = jasmine.createSpy('action');
    const unbind = bindShortcuts(target, [['ctrl+alt+shift+d', action]]);

    unbind();
    target.dispatchEvent(keydown(chord));

    expect(action).not.toHaveBeenCalled();
  });
});
