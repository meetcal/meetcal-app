import { PREMIUM_FUNCTIONS } from '../../../convex/lib/access';
import {
  ACCESS_PASS_MIN_HOLD_MS,
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
    await expect(accessPassFor('results:byNames', {}, { refused: 'p1' })).resolves.toBe('p2');
    await expect(accessPassFor('results:byNames', {}, { refused: 'p1' })).resolves.toBe('p2');
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
