import { clearHttpValidatorCache } from '@/lib/api/revalidated-reads';
import { resetServerClockForTests } from '@/lib/api/server-clock';
import { fetchWrapped } from '@/lib/api/wrapped-api';
import { isClockCall } from './json-transport-stub';
import { setAccessPassSource } from './premium-queries';
import { setApiTransportForTests, type ApiCall } from './transport';
import { itemAt } from '@/test-support/checked-access';

type Responder = (call: ApiCall) => unknown;

function installTransport(respond: Responder, clock: Responder = () => Date.now()) {
  const transport = jest.fn(
    async (call: ApiCall): Promise<unknown> => (isClockCall(call) ? clock(call) : respond(call)),
  );
  setApiTransportForTests(transport);
  const allCalls = (): ApiCall[] => transport.mock.calls.map(([{ signal: _signal, ...call }]) => call);
  const dataCalls = (): ApiCall[] => allCalls().filter((call) => !isClockCall(call));
  const clockCalls = (): ApiCall[] => allCalls().filter((call) => isClockCall(call));
  const lastCall = (): ApiCall => {
    const calls = dataCalls();
    if (calls.length === 0) throw new Error('no data call was made');
    return itemAt(calls, -1);
  };
  return { transport, dataCalls, clockCalls, lastCall };
}

beforeEach(() => {
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  setApiTransportForTests(null);
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('fetchWrapped', () => {
  afterEach(() => setAccessPassSource(null));
  const stats = {
    totalWeightLifted: 1200.0,
    totalMeets: 3.0,
    makePercentage: 75,
    bestSnatch: 100,
    bestCleanJerk: 125,
    bestTotal: 225,
    averageTotal: 215,
    topMeet: null,
    improvementFromFirst: null,
    longestMakeStreak: 5,
    favoriteAttempt: 2,
    yearRank: 'Meet Regular',
  };

  it('asks the free query with no pass, even for a subscriber, and checks the answer', async () => {
    setAccessPassSource(async () => ({ pass: 'p1', rotatesAt: Date.now() + 60_000 }));
    const { lastCall } = installTransport(() => ({ kind: 'athlete', name: 'Ada', stats }));
    await expect(fetchWrapped('ada', 2026)).resolves.toEqual({ kind: 'athlete', name: 'Ada', stats });
    expect(lastCall()).toMatchObject({ fn: 'results:wrapped', kind: 'query', args: { query: 'ada', year: 2026 } });
    expect(lastCall().args.pass).toBeUndefined();
    expect(lastCall().token).toBeUndefined();
    await fetchWrapped('Ada', 2026, true);
    expect(lastCall().args.picked).toBe(true);
  });

  it('reads every kind, and refuses a malformed answer', async () => {
    installTransport(() => ({ kind: 'ambiguous', names: ['A', 'B'], truncated: true }));
    await expect(fetchWrapped('a', 2026)).resolves.toEqual({ kind: 'ambiguous', names: ['A', 'B'], truncated: true });
    installTransport(() => ({ kind: 'none', suggestions: ['Ada'] }));
    await expect(fetchWrapped('a', 2026)).resolves.toEqual({ kind: 'none', suggestions: ['Ada'] });
    installTransport(() => ({ kind: 'narrow' }));
    await expect(fetchWrapped('a', 2026)).resolves.toEqual({ kind: 'narrow' });
    installTransport(() => ({ kind: 'tooManyResults', name: 'Ada' }));
    await expect(fetchWrapped('a', 2026)).resolves.toEqual({ kind: 'tooManyResults', name: 'Ada' });
    installTransport(() => ({ kind: 'athlete', name: 'Ada', stats: { ...stats, favoriteAttempt: 4 } }));
    await expect(fetchWrapped('a', 2026)).rejects.toThrow('favoriteAttempt');
    installTransport(() => ({ kind: 'athlete', name: 'Ada', stats: { ...stats, bestTotal: 'lots' } }));
    await expect(fetchWrapped('a', 2026)).rejects.toThrow('bestTotal');
    installTransport(() => ({ kind: 'rows' }));
    await expect(fetchWrapped('a', 2026)).rejects.toThrow('unknown kind');
  });
});
