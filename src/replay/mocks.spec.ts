import type { MockResponse, MockRule } from '..';
import { createMockStore, MOCKS_STORAGE_KEY, MockStorage } from './mocks';

/** S-16b (S16-08 … S16-10, FR-RPL-07, 08, D-53): the mock rules — match, list, persist. */
describe('mock store (S-16b)', () => {
  const BASE = 'http://app.test/base/page';
  const OK: MockResponse = { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' };
  const DOWN: MockResponse = { status: 503, headers: {}, body: 'down' };
  let stored: Map<string, string>;

  const storage = (): MockStorage => ({
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => void stored.set(key, value),
  });
  const rule = (change: Partial<Omit<MockRule, 'id'>> = {}): Omit<MockRule, 'id'> => ({
    on: true,
    method: 'GET',
    url: 'http://app.test/api/orders',
    response: OK,
    ...change,
  });
  const ask = (store: ReturnType<typeof createMockStore>, method: string, url: string) =>
    store.resolve({ method, url });

  beforeEach(() => (stored = new Map()));

  it('add() gives an id, upper-cases the method, makes a relative URL absolute; list() is a copy in order', () => {
    const store = createMockStore(storage(), BASE);
    const a = store.add(rule({ method: 'post', url: '/api/orders' }));
    const b = store.add(rule());
    expect(a).toEqual({ id: 'm1', on: true, method: 'POST', url: 'http://app.test/api/orders', response: OK });
    expect(b.id).toBe('m2');
    expect(store.list().map((r) => r.id)).toEqual(['m1', 'm2']);
    (store.list() as MockRule[]).length = 0;
    expect(store.list().length).withContext('list() is a copy').toBe(2);
  });

  it('matching: method equal or "*", URL equal; no rule or no match answers null', () => {
    const store = createMockStore(storage(), BASE);
    expect(ask(store, 'GET', 'http://app.test/api/orders')).toBeNull();
    store.add(rule());
    store.add(rule({ method: '*', url: 'http://app.test/api/any', response: DOWN }));
    expect(ask(store, 'GET', 'http://app.test/api/orders')).toEqual(OK);
    expect(ask(store, 'get', 'http://app.test/api/orders'))
      .withContext('method case')
      .toEqual(OK);
    expect(ask(store, 'POST', 'http://app.test/api/orders')).toBeNull();
    expect(ask(store, 'DELETE', 'http://app.test/api/any')).toEqual(DOWN);
    expect(ask(store, 'GET', 'http://app.test/api/orders?page=2'))
      .withContext('exact URL')
      .toBeNull();
    expect(ask(store, 'GET', 'http://app.test/api/orders/1')).toBeNull();
  });

  it('a "*" matches any run of characters in the path or query; other characters are literal', () => {
    const store = createMockStore(storage(), BASE);
    store.add(rule({ url: 'http://app.test/api/orders/*/lines?page=*' }));
    expect(ask(store, 'GET', 'http://app.test/api/orders/7/lines?page=1')).toEqual(OK);
    expect(ask(store, 'GET', 'http://app.test/api/orders/7/8/lines?page=')).toEqual(OK);
    expect(ask(store, 'GET', 'http://app.test/api/orders/7/lines')).toBeNull();
    expect(ask(store, 'GET', 'http://app.test/api/orders/7/linesXpage=1'))
      .withContext('"?" is literal')
      .toBeNull();
    expect(ask(store, 'GET', 'http://other.test/api/orders/7/lines?page=1')).toBeNull();
  });

  it('the first matching rule that is on wins; off rules are skipped', () => {
    const store = createMockStore(storage(), BASE);
    const first = store.add(rule({ on: false, response: DOWN }));
    store.add(rule({ url: 'http://app.test/api/*' }));
    store.add(rule({ response: DOWN }));
    expect(ask(store, 'GET', 'http://app.test/api/orders')).toEqual(OK);
    store.update(first.id, { on: true });
    expect(ask(store, 'GET', 'http://app.test/api/orders')).toEqual(DOWN);
  });

  it('update(), remove(), clear(); unknown ids do nothing; onChange hears each change until unsubscribed', () => {
    const store = createMockStore(storage(), BASE);
    const heard: string[][] = [];
    const stop = store.onChange((rules) => heard.push(rules.map((r) => `${r.id}:${r.method}:${r.on}`)));
    const a = store.add(rule());
    store.add(rule());
    store.update(a.id, { method: 'put', url: '/x', on: false });
    expect(store.list()[0]).toEqual(
      jasmine.objectContaining({ id: 'm1', method: 'PUT', url: 'http://app.test/x', on: false }),
    );
    store.update('nope', { on: false });
    store.remove('nope');
    store.remove(a.id);
    store.clear();
    expect(heard).toEqual([
      ['m1:GET:true'],
      ['m1:GET:true', 'm2:GET:true'],
      ['m1:PUT:false', 'm2:GET:true'],
      ['m2:GET:true'],
      [],
    ]);
    stop();
    store.add(rule());
    expect(heard.length).withContext('unsubscribed').toBe(5);
  });

  it('a throwing onChange listener costs neither the change nor the other listeners', () => {
    const store = createMockStore(storage(), BASE);
    const after = jasmine.createSpy('after');
    store.onChange(() => {
      throw new Error('listener bug');
    });
    store.onChange(after);
    store.add(rule());
    expect(store.list().length).toBe(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('D-53: every change is stored under "debug-capture:mocks" and read back by a new store; ids go on from there', () => {
    const first = createMockStore(storage(), BASE);
    first.add(rule());
    const removed = first.add(rule({ method: 'POST' }));
    first.add(rule({ method: 'PUT' }));
    first.remove(removed.id);
    expect(stored.has(MOCKS_STORAGE_KEY)).toBeTrue();

    const again = createMockStore(storage(), BASE);
    expect(again.list()).toEqual(first.list());
    expect(again.add(rule()).id).withContext('no id is given twice').toBe('m4');
    expect(ask(again, 'GET', 'http://app.test/api/orders')).toEqual(OK);
  });

  it('a corrupt stored value gives no rules; a stored rule of the wrong shape is dropped', () => {
    stored.set(MOCKS_STORAGE_KEY, '{not json');
    expect(createMockStore(storage(), BASE).list()).toEqual([]);
    stored.set(MOCKS_STORAGE_KEY, JSON.stringify({ v: 1, rules: 'no' }));
    expect(createMockStore(storage(), BASE).list()).toEqual([]);
    const good: MockRule = { id: 'm3', ...rule() };
    stored.set(
      MOCKS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        rules: [
          good,
          { ...good, id: 'm4', on: 'yes' },
          { ...good, id: 'm5', response: { status: '200', headers: {}, body: '' } },
          { ...good, id: 'm6', response: { ...OK, headers: { a: 1 } } },
          null,
        ],
      }),
    );
    expect(createMockStore(storage(), BASE).list()).toEqual([good]);
  });

  it('blocked storage (null, or a getter and setter that throw): rules live for this page only', () => {
    const none = createMockStore(null, BASE);
    none.add(rule());
    expect(ask(none, 'GET', 'http://app.test/api/orders')).toEqual(OK);

    const throwing: MockStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    const blocked = createMockStore(throwing, BASE);
    expect(() => blocked.add(rule())).not.toThrow();
    expect(blocked.list().length).toBe(1);
  });
});
