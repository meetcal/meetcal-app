import { fetchApiClubMeets } from './clubs-api';
import { MeetCalApiError, MeetCalApiTimeoutError } from './meetcal-api';
import { clearHttpValidatorCache } from './revalidated-reads';
import { patchAutoUnsavePreference } from './user-preferences-api';
import { READ_MAX_ATTEMPTS, REQUEST_INACTIVITY_TIMEOUT_MS } from './network-policy';
import { resetServerClockForTests } from './server-clock';
import { setApiTransportForTests, TransportRequestError, type ApiCall } from './transport';

const mockIsNetworkAvailable = jest.fn(async () => true);
jest.mock('@/lib/networkUtils', () => ({
  isNetworkAvailable: () => mockIsNetworkAvailable(),
  subscribeToNetworkChanges: () => () => {},
}));

type Step = (call: ApiCall) => Promise<unknown>;

function scriptedTransport(steps: Step[]) {
  const dataCalls: ApiCall[] = [];
  const transport = jest.fn(async (call: ApiCall) => {
    if (call.kind === 'clock') return Date.now();
    dataCalls.push(call);
    const step = steps.shift();
    if (!step) throw new Error('unexpected call');
    return step(call);
  });
  setApiTransportForTests(transport, { retryReads: true });
  return dataCalls;
}

const clubMeetsAnswer = { meets: [{ meet: 'Meet A', date: '2026-01-01' }] };
const networkDown: Step = async () => {
  throw new TypeError('Network request failed');
};

beforeEach(() => {
  clearHttpValidatorCache();
  resetServerClockForTests();
  mockIsNetworkAvailable.mockImplementation(async () => true);
});

afterEach(() => {
  jest.useRealTimers();
  setApiTransportForTests(null);
});

describe('request inactivity timeout', () => {
  it('lets a transfer that keeps receiving bytes run past the limit', async () => {
    jest.useFakeTimers();
    let finish: (value: unknown) => void = () => undefined;
    let report: () => void = () => undefined;
    scriptedTransport([
      (call) => {
        report = call.onProgress ?? (() => undefined);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    ]);
    const pending = fetchApiClubMeets('Club').catch((error: unknown) => error);
    for (let tick = 0; tick < 6; tick += 1) {
      await jest.advanceTimersByTimeAsync(REQUEST_INACTIVITY_TIMEOUT_MS - 1);
      report();
    }
    finish(clubMeetsAnswer);
    expect(await pending).toEqual([{ meet: 'Meet A', date: '2026-01-01' }]);
  });

  it('times out a transfer once no byte has arrived for the limit, and aborts it', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const hang: Step = (call) => {
      signal = call.signal;
      call.onProgress?.();
      return new Promise(() => {});
    };
    setApiTransportForTests(
      async (call) => (call.kind === 'clock' ? Date.now() : hang(call)),
      { retryReads: false },
    );
    const pending = fetchApiClubMeets('Club').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(REQUEST_INACTIVITY_TIMEOUT_MS);
    const failure = await pending;
    expect(failure).toBeInstanceOf(MeetCalApiTimeoutError);
    expect(signal?.aborted).toBe(true);
  });
});

describe('read retries', () => {
  it('retries a read that failed on the network and answers with the retry', async () => {
    jest.useFakeTimers();
    const calls = scriptedTransport([networkDown, async () => clubMeetsAnswer]);
    const pending = fetchApiClubMeets('Club').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(await pending).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it(`retries a timed-out read and gives up after ${READ_MAX_ATTEMPTS} attempts`, async () => {
    jest.useFakeTimers();
    const hang: Step = () => new Promise(() => {});
    const calls = scriptedTransport([hang, hang, hang]);
    const pending = fetchApiClubMeets('Club').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(READ_MAX_ATTEMPTS * REQUEST_INACTIVITY_TIMEOUT_MS + 10_000);
    expect(await pending).toBeInstanceOf(MeetCalApiTimeoutError);
    expect(calls).toHaveLength(READ_MAX_ATTEMPTS);
  });

  it('does not retry an answer a retry cannot change', async () => {
    const calls = scriptedTransport([
      async () => {
        throw new TransportRequestError('query failed with 404', 404, '{"status":404}');
      },
    ]);
    const failure = await fetchApiClubMeets('Club').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiError).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('does not retry while the device is offline', async () => {
    mockIsNetworkAvailable.mockImplementation(async () => false);
    const calls = scriptedTransport([networkDown]);
    await expect(fetchApiClubMeets('Club')).rejects.toThrow('Network request failed');
    expect(calls).toHaveLength(1);
  });

  it('never retries a write', async () => {
    const calls = scriptedTransport([networkDown]);
    await expect(patchAutoUnsavePreference('clerk-token', true)).rejects.toThrow('Network request failed');
    expect(calls).toHaveLength(1);
  });
});
