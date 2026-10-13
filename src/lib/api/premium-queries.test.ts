import { PREMIUM_FUNCTIONS } from '../../../convex/lib/access';
import { DATA_TOKEN_TIMEOUT_MS, dataTokenFor, PREMIUM_QUERY_FUNCTIONS, setDataTokenSource } from './premium-queries';

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
