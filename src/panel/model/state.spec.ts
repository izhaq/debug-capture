import { httpEntry, logEntry, pendingRequest } from './fakes.spec';
import { EMPTY_FILTERS, isPendingRow, rowKey } from './state';

describe('panel state helpers', () => {
  it('isPendingRow tells an in-flight request from a finished one', () => {
    expect(isPendingRow(pendingRequest(1))).toBe(true);
    expect(isPendingRow(httpEntry(1))).toBe(false);
  });

  it('rowKey: seq for entries, p + id for pending requests — never equal', () => {
    expect(rowKey(httpEntry(7))).toBe('7');
    expect(rowKey(logEntry(8))).toBe('8');
    expect(rowKey(pendingRequest(7))).toBe('p7');
  });

  it('EMPTY_FILTERS is frozen all the way down', () => {
    expect(Object.isFrozen(EMPTY_FILTERS)).toBe(true);
    expect(Object.isFrozen(EMPTY_FILTERS.http)).toBe(true);
    expect(Object.isFrozen(EMPTY_FILTERS.ws.direction)).toBe(true);
    expect(Object.isFrozen(EMPTY_FILTERS.console.levels)).toBe(true);
  });
});
