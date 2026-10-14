import { PREMIUM_FUNCTIONS } from '../../../convex/lib/access';
import { DATA_TOKEN_RETRY_AFTER_MS, DATA_TOKEN_TIMEOUT_MS, dataTokenFor, PREMIUM_QUERY_FUNCTIONS, setDataTokenSource, wantsDataToken } from './premium-queries';

afterEach(() => {
  setDataTokenSource(null);
  jest.useRealTimers();
});

describe('premium queries', () => {
  it('are exactly the ones the server gates', () => {
    expect([...PREMIUM_QUERY_FUNCTIONS].sort()).toEqual([...PREMIUM_FUNCTIONS].sort());
  });
});

describe('dataTokenFor', () => {
  it("gives a premium read the signed-in user's token, and nothing else one", async () => {
    const source = jest.fn(async () => 'token');
    setDataTokenSource(source);
    await expect(dataTokenFor('results:byNames')).resolves.toBe('token');
    await expect(dataTokenFor('meets:schedule')).resolves.toBeUndefined();
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('sends the read anonymously when nobody is signed in or Clerk has no token', async () => {
    await expect(dataTokenFor('results:byNames')).resolves.toBeUndefined();
    setDataTokenSource(async () => null);
    await expect(dataTokenFor('results:byNames')).resolves.toBeUndefined();
    setDataTokenSource(async () => '');
    await expect(dataTokenFor('results:byNames')).resolves.toBeUndefined();
    setDataTokenSource(async () => {
      throw new Error('offline');
    });
    await expect(dataTokenFor('results:byNames')).resolves.toBeUndefined();
  });

  it('does not wait on Clerk past its timeout', async () => {
    jest.useFakeTimers();
    setDataTokenSource(() => new Promise(() => {}));
    const token = dataTokenFor('results:byNames');
    jest.advanceTimersByTime(DATA_TOKEN_TIMEOUT_MS);
    await expect(token).resolves.toBeUndefined();
  });
});

describe('the token on searches and after Clerk fails', () => {
  it('goes with a search only when it asks for results: name suggestions are public', async () => {
    setDataTokenSource(async () => 'token');
    await expect(dataTokenFor('results:search', { query: 'Ada' })).resolves.toBeUndefined();
    await expect(dataTokenFor('results:search', { query: 'Ada', startDate: '2026-01-01', endDate: '2026-12-31' })).resolves.toBe('token');
  });

  it('asks Clerk once for reads made together', async () => {
    const source = jest.fn(async () => 'token');
    setDataTokenSource(source);
    await expect(Promise.all([dataTokenFor('results:byNames'), dataTokenFor('reference:records')])).resolves.toEqual(['token', 'token']);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('stops asking for a while after Clerk gave nothing, so later reads do not each wait', async () => {
    jest.useFakeTimers({ now: 0 });
    const source = jest.fn(() => new Promise<string | null>(() => {}));
    setDataTokenSource(source);
    const first = dataTokenFor('results:byNames');
    jest.advanceTimersByTime(DATA_TOKEN_TIMEOUT_MS);
    await expect(first).resolves.toBeUndefined();
    expect(wantsDataToken('results:byNames')).toBe(false);
    await expect(dataTokenFor('results:byNames')).resolves.toBeUndefined();
    expect(source).toHaveBeenCalledTimes(1);
    jest.setSystemTime(DATA_TOKEN_TIMEOUT_MS + DATA_TOKEN_RETRY_AFTER_MS);
    expect(wantsDataToken('results:byNames')).toBe(true);
  });
});
