import {
  EnvironmentInjector,
  ErrorHandler,
  FactoryProvider,
  Injector,
  Provider,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';

import { CaptureSession, EntryDraft } from '..';
import { DebugCaptureErrorHandler } from './debug-capture.error-handler';
import { provideDebugCapture, provideDebugCaptureSession } from './debug-capture.providers';

/**
 * C-4: the package is built with plain `tsc`, not the Angular compiler. A
 * decorated class compiled that way carries no factory in an AOT host (and
 * asks for the JIT compiler at run time). So the handler has no decorator
 * and provideDebugCapture() builds it with a factory.
 *
 * These specs use bare injectors — no TestBed, no NgModule — the way an AOT
 * host's platform and root injectors are built.
 */
describe('debug-capture Angular seam without decorators', () => {
  const now = 1_760_000_000_000;

  let drafts: EntryDraft[];

  /** A recorder that pushes drafts into `drafts`, and a fixed clock. */
  function fakeSession(): CaptureSession {
    return {
      recorder: {
        record: (draft) => {
          drafts.push(draft);
        },
        snapshot: () => [],
        clear: () => undefined,
        stats: () => ({ recorded: 0, dropped: 0, evicted: 0, failed: 0 }),
        onEntry: () => () => undefined,
      },
      clock: { now: () => now },
      active: true,
      toJson: () => '',
      download: () => undefined,
      copy: () => Promise.resolve(false),
      clear: () => undefined,
      dispose: () => undefined,
    };
  }

  function isFactoryProvider(provider: Provider): provider is FactoryProvider {
    return typeof provider === 'object' && provider !== null && 'useFactory' in provider;
  }

  beforeEach(() => {
    drafts = [];
    // Angular's default handler logs every error; keep the run output clean.
    spyOn(console, 'error');
  });

  it('the handler class carries no Angular compiler metadata', () => {
    // @Injectable() adds these statics (the JIT compiler fills them in on
    // first read). Without the decorator there must be none on the class.
    const own = (key: string): boolean => Object.prototype.hasOwnProperty.call(DebugCaptureErrorHandler, key);

    expect(own('ɵfac')).toBeFalse();
    expect(own('ɵprov')).toBeFalse();
    expect(own('decorators')).toBeFalse();
  });

  it('provideDebugCapture() provides ErrorHandler through a factory, not useClass', () => {
    const providers = provideDebugCapture();

    expect(providers.length).toBe(1);
    const [provider] = providers;
    expect(isFactoryProvider(provider)).toBeTrue();
    expect(provider).toEqual(jasmine.objectContaining({ provide: ErrorHandler }));
    expect(provider).not.toEqual(jasmine.objectContaining({ useClass: jasmine.anything() }));
  });

  it('records an error from an injector built with Injector.create', () => {
    const injector = Injector.create({
      providers: [...provideDebugCapture(), provideDebugCaptureSession(fakeSession())],
    });
    const handler = injector.get(ErrorHandler);
    const error = new Error('template blew up');

    handler.handleError(error);

    expect(handler).toBeInstanceOf(DebugCaptureErrorHandler);
    expect(drafts).toEqual([
      { kind: 'error', source: 'angular', t: now, message: 'template blew up', stack: error.stack ?? null },
    ]);
    expect(console.error).toHaveBeenCalledOnceWith('ERROR', error);
  });

  it('reads a platform-level session from a root environment injector', () => {
    // The real layout: main.ts puts the session on the platform injector and
    // provideDebugCapture() sits in the root (environment) injector below it.
    const platform = Injector.create({ providers: [provideDebugCaptureSession(fakeSession())] });
    if (!(platform instanceof EnvironmentInjector)) {
      fail('Injector.create is expected to build an EnvironmentInjector');
      return;
    }
    const root = createEnvironmentInjector(provideDebugCapture(), platform);
    const error = new Error('lifecycle hook failed');

    root.get(ErrorHandler).handleError(error);

    expect(drafts).toEqual([jasmine.objectContaining({ source: 'angular', message: 'lifecycle hook failed' })]);
    root.destroy();
  });

  it('only delegates when the injector has no session', () => {
    const injector = Injector.create({ providers: provideDebugCapture() });
    const error = new Error('no capture');

    injector.get(ErrorHandler).handleError(error);

    expect(drafts).toEqual([]);
    expect(console.error).toHaveBeenCalledOnceWith('ERROR', error);
  });

  it('works when a host builds the handler by hand inside runInInjectionContext', () => {
    const injector = Injector.create({ providers: [provideDebugCaptureSession(fakeSession())] });
    if (!(injector instanceof EnvironmentInjector)) {
      fail('Injector.create is expected to build an EnvironmentInjector');
      return;
    }

    const handler = runInInjectionContext(injector, () => new DebugCaptureErrorHandler());
    handler.handleError(new Error('by hand'));

    expect(drafts).toEqual([jasmine.objectContaining({ message: 'by hand' })]);
  });

  it('throws NG0203 when built by hand outside an injection context', () => {
    // Documented, not hidden: `new DebugCaptureErrorHandler()` in plain code
    // has no injector to read the session from. Angular's own inject() error
    // says so at once, instead of a handler that silently records nothing.
    expect(() => new DebugCaptureErrorHandler()).toThrowError(/NG0203/);
  });
});
