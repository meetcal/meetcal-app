import { PREMIUM_FUNCTIONS } from '../../../convex/lib/access';
import {
  ACCESS_PASS_MIN_HOLD_MS,
  ACCESS_PASS_READY_TIMEOUT_MS,
  ACCESS_PASS_RESTORE_TIMEOUT_MS,
  ACCESS_PASS_RETRY_AFTER_MS,
  ACCESS_PASS_TIMEOUT_MS,
  accessPassFor,
  PREMIUM_QUERY_FUNCTIONS,
  setAccessPassSource,
  wantsAccessPass,
} from './premium-queries';

const NOW = Date.UTC(2026, 9, 13, 12);
const pass = (value: string, rotatesAt = NOW + 60_000) => ({ pass: value, rotatesAt });

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => {
  setAccessPassSource(null);
  jest.useRealTimers();
});

describe('premium queries', () => {
  it('are exactly the ones the server gates', () => {
    expect([...PREMIUM_QUERY_FUNCTIONS].sort()).toEqual([...PREMIUM_FUNCTIONS].sort());
  });

  it('carry the pass only while a subscriber is signed in, and a search only when it asks for results', () => {
    expect(wantsAccessPass('results:byNames')).toBe(false);
    setAccessPassSource(async () => pass('p1'));
    expect(wantsAccessPass('results:byNames')).toBe(true);
    expect(wantsAccessPass('meets:schedule')).toBe(false);
    expect(wantsAccessPass('results:search', { query: 'Ada' })).toBe(false);
    expect(wantsAccessPass('results:search', { query: 'Ada', startDate: '2026-01-01', endDate: '2026-12-31' })).toBe(true);
  });
});

describe('accessPassFor', () => {
  it('fetches the pass once for every read until it rotates, then fetches the next', async () => {
    const rotatesAt = NOW + 2 * ACCESS_PASS_MIN_HOLD_MS;
    const source = jest.fn().mockResolvedValueOnce(pass('p1', rotatesAt)).mockResolvedValueOnce(pass('p2', rotatesAt + 60_000));
    setAccessPassSource(source);
    await expect(Promise.all([accessPassFor('results:byNames'), accessPassFor('reference:records')])).resolves.toEqual(['p1', 'p1']);
    await expect(accessPassFor('results:bests')).resolves.toBe('p1');
    expect(source).toHaveBeenCalledTimes(1);
    jest.setSystemTime(rotatesAt);
    await expect(accessPassFor('results:bests')).resolves.toBe('p2');
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('holds a pass a few minutes even when its rotation time has passed (a clock ahead, a late rotation)', async () => {
    const source = jest.fn(async () => pass('p1', NOW - 1000));
    setAccessPassSource(source);
    for (let i = 0; i < 5; i++) await expect(accessPassFor('results:byNames')).resolves.toBe('p1');
    expect(source).toHaveBeenCalledTimes(1);
    jest.setSystemTime(NOW + ACCESS_PASS_MIN_HOLD_MS);
    await accessPassFor('results:byNames');
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('fetches a new pass for a refused one, unless another read already replaced it', async () => {
    const source = jest.fn().mockResolvedValueOnce(pass('p1')).mockResolvedValueOnce(pass('p2'));
    setAccessPassSource(source);
    await accessPassFor('results:byNames');
    await expect(accessPassFor('results:byNames', {}, { refused: 'p1', retry: true })).resolves.toBe('p2');
    await expect(accessPassFor('results:byNames', {}, { refused: 'p1', retry: true })).resolves.toBe('p2');
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('keeps using a rotated pass, still accepted for a day, while a new one cannot be had', async () => {
    const source = jest.fn().mockResolvedValueOnce(pass('p1')).mockResolvedValueOnce(null);
    setAccessPassSource(source);
    await accessPassFor('results:byNames');
    jest.setSystemTime(NOW + ACCESS_PASS_MIN_HOLD_MS);
    await expect(accessPassFor('results:byNames')).resolves.toBe('p1');
  });

  it('keeps a pass that arrives after the reads stopped waiting for it', async () => {
    let resolve!: (value: { pass: string; rotatesAt: number }) => void;
    const source = jest.fn(() => new Promise<{ pass: string; rotatesAt: number }>((r) => (resolve = r)));
    setAccessPassSource(source);
    const first = accessPassFor('results:byNames');
    jest.advanceTimersByTime(ACCESS_PASS_TIMEOUT_MS);
    await expect(first).resolves.toBeUndefined();
    // A read while the slow fetch still runs does not wait out a new timeout.
    await expect(accessPassFor('results:byNames')).resolves.toBeUndefined();
    resolve(pass('late'));
    await Promise.resolve();
    await expect(accessPassFor('results:byNames')).resolves.toBe('late');
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('sends reads without a pass when there is none, and does not ask again for a while', async () => {
    const source = jest.fn(async () => null);
    setAccessPassSource(source);
    await expect(accessPassFor('results:byNames')).resolves.toBeUndefined();
    await expect(accessPassFor('results:byNames')).resolves.toBeUndefined();
    expect(source).toHaveBeenCalledTimes(1);
    jest.setSystemTime(NOW + ACCESS_PASS_RETRY_AFTER_MS);
    await accessPassFor('results:byNames');
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("drops a pass fetched for a previous user", async () => {
    let resolve!: (value: { pass: string; rotatesAt: number }) => void;
    setAccessPassSource(() => new Promise((r) => (resolve = r)));
    const stale = accessPassFor('results:byNames');
    setAccessPassSource(async () => pass('theirs'));
    resolve(pass('mine'));
    await expect(stale).resolves.toBeUndefined();
    await expect(accessPassFor('results:byNames')).resolves.toBe('theirs');
  });

  it('gives a non-premium read nothing, without asking', async () => {
    const source = jest.fn(async () => pass('p1'));
    setAccessPassSource(source);
    await expect(accessPassFor('meets:schedule')).resolves.toBeUndefined();
    expect(source).not.toHaveBeenCalled();
  });
});

describe('a source that is not ready yet (Clerk loading)', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('does not count the wait for readiness against the pass fetch', async () => {
    let ready!: () => void;
    const source = jest.fn(() => new Promise<{ pass: string; rotatesAt: number }>((resolve) => setTimeout(() => resolve(pass('p1')), 500)));
    setAccessPassSource(source, new Promise<void>((resolve) => (ready = resolve)));
    const read = accessPassFor('results:byNames');
    jest.advanceTimersByTime(2800);
    await flush();
    expect(source).not.toHaveBeenCalled();
    ready();
    await flush();
    expect(source).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(500);
    await expect(read).resolves.toBe('p1');
  });

  it('goes without a pass when the source is not ready in time, and fetches nothing', async () => {
    const source = jest.fn(async () => pass('p1'));
    setAccessPassSource(source, new Promise<void>(() => {}));
    const read = accessPassFor('results:byNames');
    jest.advanceTimersByTime(ACCESS_PASS_READY_TIMEOUT_MS);
    await expect(read).resolves.toBeUndefined();
    expect(source).not.toHaveBeenCalled();
  });

  it('gives a refused read a fresh wait on a fetch still running', async () => {
    let resolve!: (value: { pass: string; rotatesAt: number }) => void;
    setAccessPassSource(() => new Promise((r) => (resolve = r)));
    const first = accessPassFor('results:byNames');
    jest.advanceTimersByTime(ACCESS_PASS_TIMEOUT_MS);
    await expect(first).resolves.toBeUndefined();
    // The server refused the read sent without a pass: its retry waits again.
    const retry = accessPassFor('results:byNames', {}, { retry: true });
    await flush();
    resolve(pass('late'));
    await expect(retry).resolves.toBe('late');
  });
});

describe('a stored pass', () => {
  function memoryStore(initial: { pass: string; rotatesAt: number } | null) {
    let value = initial;
    return {
      read: jest.fn(async () => value),
      write: jest.fn(async (next: { pass: string; rotatesAt: number }) => {
        value = next;
      }),
      forget: jest.fn(async () => {
        value = null;
      }),
      current: () => value,
    };
  }

  it('is used until it rotates and stores the pass fetched after it', async () => {
    const store = memoryStore(pass('kept', NOW + 60_000));
    const source = jest.fn(async () => pass('fresh', NOW + 10 * 60_000));
    setAccessPassSource(source, undefined, store);
    await expect(accessPassFor('reference:records')).resolves.toBe('kept');
    expect(source).not.toHaveBeenCalled();
    jest.setSystemTime(NOW + 60_000);
    await expect(accessPassFor('reference:records')).resolves.toBe('fresh');
    await Promise.resolve();
    expect(store.current()).toEqual(pass('fresh', NOW + 10 * 60_000));
  });

  it('is forgotten when the server refuses it', async () => {
    const store = memoryStore(pass('kept', NOW + 60_000));
    setAccessPassSource(async () => pass('fresh'), undefined, store);
    await expect(accessPassFor('reference:records')).resolves.toBe('kept');
    await expect(accessPassFor('reference:records', {}, { refused: 'kept', retry: true })).resolves.toBe('fresh');
    expect(store.forget).toHaveBeenCalled();
  });

  it('is not waited on longer than the restore timeout', async () => {
    const store = {
      read: () => new Promise<null>(() => {}),
      write: jest.fn(async () => {}),
      forget: jest.fn(async () => {}),
    };
    setAccessPassSource(async () => pass('fresh'), undefined, store);
    const pending = accessPassFor('reference:records');
    await jest.advanceTimersByTimeAsync(ACCESS_PASS_RESTORE_TIMEOUT_MS);
    await expect(pending).resolves.toBe('fresh');
  });

  it('is ignored once a different source is set', async () => {
    const store = memoryStore(pass('kept', NOW + 60_000));
    setAccessPassSource(async () => pass('fresh'), undefined, store);
    setAccessPassSource(async () => pass('other'));
    await expect(accessPassFor('reference:records')).resolves.toBe('other');
  });
});
