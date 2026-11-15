import type { MockResolver, MockResponse, MockRule, Unsubscribe } from '..';

/** D-53: where the rules live, so they apply again after a reload until turned off. */
export const MOCKS_STORAGE_KEY = 'debug-capture:mocks';

/** The part of `localStorage` the store uses. */
export type MockStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** S16-08 … S16-10: the mock rules, their matching and their storage. */
export interface MockStore {
  list(): readonly MockRule[];
  add(rule: Omit<MockRule, 'id'>): MockRule;
  update(id: string, change: Partial<Omit<MockRule, 'id'>>): void;
  remove(id: string): void;
  clear(): void;
  onChange(listener: (rules: readonly MockRule[]) => void): Unsubscribe;
  /** For `setMockResolver`: the first rule that is on and matches answers. */
  readonly resolve: MockResolver;
}

interface Compiled {
  readonly rule: MockRule;
  readonly test: (url: string) => boolean;
}

/**
 * A small pure store (S16-09, S16-10). `storage` is read once here and
 * written after each change, best effort: `null` or a throwing storage keeps
 * the rules for this page only. `base` makes a relative URL absolute.
 */
export function createMockStore(storage: MockStorage | null, base: string): MockStore {
  let rules: Compiled[] = read(storage).map(compile);
  let next = rules.reduce((n, { rule }) => Math.max(n, Number(rule.id.slice(1)) || 0), 0);
  const listeners = new Set<(rules: readonly MockRule[]) => void>();

  const list = (): MockRule[] => rules.map((c) => c.rule);
  const changed = (all: Compiled[]): void => {
    rules = all;
    try {
      storage?.setItem(MOCKS_STORAGE_KEY, JSON.stringify({ v: 1, rules: list() }));
    } catch {
      // Full or blocked: the rules still apply to this page.
    }
    for (const listener of [...listeners]) {
      try {
        listener(list());
      } catch {
        // A listener's bug costs the others nothing.
      }
    }
  };
  const tidy = (rule: MockRule): MockRule => ({
    ...rule,
    method: rule.method.toUpperCase(),
    url: absolute(rule.url, base),
  });

  return {
    list,
    add(rule) {
      const made = tidy({ ...rule, id: `m${++next}` });
      changed([...rules, compile(made)]);
      return made;
    },
    update(id, change) {
      if (!rules.some((c) => c.rule.id === id)) return;
      changed(rules.map((c) => (c.rule.id === id ? compile(tidy({ ...c.rule, ...change, id })) : c)));
    },
    remove(id) {
      if (rules.some((c) => c.rule.id === id)) changed(rules.filter((c) => c.rule.id !== id));
    },
    clear() {
      changed([]);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resolve(request) {
      const method = request.method.toUpperCase();
      const hit = rules.find(
        ({ rule, test }) => rule.on && (rule.method === '*' || rule.method === method) && test(request.url),
      );
      return hit ? hit.rule.response : null;
    },
  };
}

/** S16-09: equal, or with `*` as any run of characters; everything else literal. */
function compile(rule: MockRule): Compiled {
  if (!rule.url.includes('*')) return { rule, test: (url) => url === rule.url };
  const pattern = new RegExp(
    `^${rule.url
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  return { rule, test: (url) => pattern.test(url) };
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** S16-10: a corrupt value gives no rules; a rule of the wrong shape is dropped. */
function read(storage: MockStorage | null): MockRule[] {
  try {
    const raw = storage?.getItem(MOCKS_STORAGE_KEY);
    const found = raw ? (JSON.parse(raw) as { rules?: unknown } | null)?.rules : null;
    return Array.isArray(found) ? found.filter(isRule) : [];
  } catch {
    return [];
  }
}

function isRule(value: unknown): value is MockRule {
  const r = value as Partial<MockRule> | null;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.id === 'string' &&
    typeof r.on === 'boolean' &&
    typeof r.method === 'string' &&
    typeof r.url === 'string' &&
    isResponse(r.response)
  );
}

function isResponse(value: unknown): value is MockResponse {
  const r = value as Partial<MockResponse> | null | undefined;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.status === 'number' &&
    (r.statusText === undefined || typeof r.statusText === 'string') &&
    typeof r.body === 'string' &&
    typeof r.headers === 'object' &&
    r.headers !== null &&
    Object.values(r.headers).every((v) => typeof v === 'string')
  );
}
