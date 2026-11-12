import { clearHttpValidatorCache } from '@/lib/api/revalidated-reads';
import { fetchApiWsoList } from '@/lib/api/reference-api';
import { fetchApiMeets } from '@/lib/api/meets-api';
import { fetchApiClubNames } from '@/lib/api/clubs-api';
import { awaitServerClock, getServerClockSample, getServerClockSkewMs, getTrustedNow, MAX_PLAUSIBLE_CLOCK_SKEW_MS, SERVER_CLOCK_DECISION_GRACE_MS, resetServerClockForTests, SERVER_CLOCK_RESAMPLE_MS } from '@/lib/api/server-clock';
import { MeetCalApiError } from '@/lib/api/meetcal-api';
import { isClockCall } from './json-transport-stub';
import { setApiTransportForTests, TransportRequestError, type ApiCall } from './transport';
import { itemAt } from '@/test-support/checked-access';

const HOUR_MS = 60 * 60 * 1000;

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

function answer(body: unknown, etag: string | null = null): Responder {
  return (call) => (call.conditional ? { etag, body } : body);
}

function apiFailure(status: number, data: Record<string, unknown> = { error: 'failed' }) {
  return new TransportRequestError(
    `query failed with ${status}`,
    status,
    JSON.stringify({ status, ...data }),
  );
}

function never(): Promise<never> {
  return new Promise<never>(() => {});
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
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

describe('server clock', () => {
  const T0 = Date.parse('2026-06-20T12:00:00.000Z');

  it('has no trusted clock before the first response', () => {
    expect(getServerClockSample()).toBeNull();
    expect(getServerClockSkewMs()).toBeNull();
    expect(getTrustedNow()).toBeNull();
  });

  it('samples the server clock alongside the first request, so a fast device clock is corrected', async () => {
    const serverNow = T0;
    jest.useFakeTimers({ now: serverNow + 3 * HOUR_MS });
    const { clockCalls } = installTransport(answer([]), () => serverNow);

    await fetchApiMeets();

    expect(clockCalls()).toEqual([
      { path: '/clock', fn: 'system:ping', kind: 'clock', args: {} },
    ]);
    expect(getServerClockSkewMs()).toBe(-3 * HOUR_MS);
    expect(getServerClockSample()).toEqual({
      skewMs: -3 * HOUR_MS,
      sampledAt: Date.now(),
    });
    expect(getTrustedNow()?.getTime()).toBe(serverNow);
    expect(Math.abs(getServerClockSkewMs() ?? 0)).toBeGreaterThan(MAX_PLAUSIBLE_CLOCK_SKEW_MS);
  });

  it('sends the clock call without holding the request back, and measures skew from the round-trip midpoint', async () => {
    jest.useFakeTimers({ now: T0 });
    const clock = deferred<number>();
    const { clockCalls, dataCalls } = installTransport(answer(['Club A']), () => clock.promise);

    const pending = fetchApiClubNames();
    expect(clockCalls()).toHaveLength(1);
    expect(dataCalls()).toHaveLength(1);

    jest.setSystemTime(T0 + 400);
    clock.resolve(T0 + 1000);

    await expect(pending).resolves.toEqual(['Club A']);
    expect(getServerClockSample()).toEqual({ skewMs: 800, sampledAt: T0 + 400 });
    expect(getTrustedNow()?.getTime()).toBe(T0 + 400 + 800);
  });

  it('evaluates the meets window on the server clock, rounded down to the hour', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-06-20T14:10:00.000Z') });
    const { dataCalls } = installTransport(answer([]), () => Date.now() - 3 * HOUR_MS);

    await fetchApiMeets();
    await fetchApiMeets();

    expect(dataCalls().map((call) => call.args.now)).toEqual([
      Date.parse('2026-06-20T14:00:00.000Z'),
      Date.parse('2026-06-20T11:00:00.000Z'),
    ]);
  });

  it('keeps a fresh sample and refreshes a stale one in the background', async () => {
    jest.useFakeTimers({ now: T0 });
    let clockAnswer: () => unknown = () => Date.now() + 5000;
    const { clockCalls } = installTransport(answer([]), () => clockAnswer());

    await fetchApiClubNames();
    expect(getServerClockSkewMs()).toBe(5000);
    expect(clockCalls()).toHaveLength(1);

    jest.setSystemTime(T0 + SERVER_CLOCK_RESAMPLE_MS);
    await fetchApiClubNames();
    expect(clockCalls()).toHaveLength(1);

    const refresh = deferred<number>();
    clockAnswer = () => refresh.promise;
    jest.setSystemTime(T0 + SERVER_CLOCK_RESAMPLE_MS + 1);
    await expect(fetchApiClubNames()).resolves.toEqual([]);
    expect(clockCalls()).toHaveLength(2);
    await fetchApiClubNames();
    expect(clockCalls()).toHaveLength(2);
    expect(getServerClockSkewMs()).toBe(5000);

    refresh.resolve(Date.now() + 7000);
    await flushMicrotasks();
    expect(getServerClockSample()).toEqual({
      skewMs: 7000,
      sampledAt: T0 + SERVER_CLOCK_RESAMPLE_MS + 1,
    });
  });

  it('does not fail the request when the clock call fails or answers junk, and tries again next time', async () => {
    jest.useFakeTimers({ now: T0 });
    const clockAnswers: (() => unknown)[] = [
      () => {
        throw new Error('mutation failed');
      },
      () => 'soon',
      () => Number.NaN,
      () => T0 + 30_000,
    ];
    const { clockCalls } = installTransport(answer(['Club A']), () => clockAnswers.shift()?.());

    for (let i = 0; i < 3; i += 1) {
      await expect(fetchApiClubNames()).resolves.toEqual(['Club A']);
      await flushMicrotasks();
      expect(getServerClockSample()).toBeNull();
      expect(getTrustedNow()).toBeNull();
    }
    await fetchApiClubNames();
    await flushMicrotasks();

    expect(clockCalls()).toHaveLength(4);
    expect(getServerClockSkewMs()).toBe(30_000);
  });

  it('samples the clock even when the request it rides alongside fails', async () => {
    jest.useFakeTimers({ now: T0 });
    installTransport(
      () => {
        throw apiFailure(500);
      },
      () => T0 + 60_000,
    );

    await expect(fetchApiMeets()).rejects.toBeInstanceOf(MeetCalApiError);
    await flushMicrotasks();
    expect(getServerClockSkewMs()).toBe(60_000);
  });

  it('does not hold the first request for a clock call that never answers', async () => {
    jest.useFakeTimers({ now: T0 });
    installTransport(answer(['Club A']), () => never());
    let settled = false;
    const pending = fetchApiClubNames().finally(() => {
      settled = true;
    });

    await flushMicrotasks();
    expect(settled).toBe(true);
    await expect(pending).resolves.toEqual(['Club A']);
    expect(getServerClockSample()).toBeNull();
    expect(jest.getTimerCount()).toBe(1);
  });

  it('leaves the first sample behind once its answer lands, after the request has returned', async () => {
    jest.useFakeTimers({ now: T0 });
    const clock = deferred<number>();
    installTransport(answer(['Club A']), () => clock.promise);

    await expect(fetchApiClubNames()).resolves.toEqual(['Club A']);
    expect(getTrustedNow()).toBeNull();

    clock.resolve(T0 + 30_000);
    await flushMicrotasks();
    expect(getServerClockSkewMs()).toBe(30_000);
  });

  it('does not hold later requests for a clock call that is still stuck', async () => {
    jest.useFakeTimers({ now: T0 });
    const { clockCalls } = installTransport(answer(['Club A']), () => never());

    await fetchApiClubNames();

    let settled = false;
    const second = fetchApiClubNames().finally(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(true);
    await expect(second).resolves.toEqual(['Club A']);
    expect(clockCalls()).toHaveLength(1);
  });

  it('does not hold either of two startup requests for the clock call the first one started', async () => {
    jest.useFakeTimers({ now: T0 });
    const { clockCalls, dataCalls } = installTransport(answer(['Club A']), () => never());
    let firstSettled = false;
    let secondSettled = false;

    const first = fetchApiClubNames().finally(() => {
      firstSettled = true;
    });
    const second = fetchApiWsoList().finally(() => {
      secondSettled = true;
    });
    expect(clockCalls()).toHaveLength(1);
    expect(dataCalls()).toHaveLength(2);

    await flushMicrotasks();
    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);
    await expect(first).resolves.toEqual(['Club A']);
    await expect(second).resolves.toEqual(['Club A']);
  });

  it('abandons a stuck clock call after 10s so a later request can start a new one', async () => {
    const SAMPLE_TIMEOUT_MS = 10000;
    jest.useFakeTimers({ now: T0 });
    let clockAnswer: () => unknown = () => never();
    const { clockCalls } = installTransport(answer(['Club A']), () => clockAnswer());

    await fetchApiClubNames();

    jest.advanceTimersByTime(SAMPLE_TIMEOUT_MS - 1);
    await fetchApiClubNames();
    expect(clockCalls()).toHaveLength(1);

    jest.advanceTimersByTime(1);
    await flushMicrotasks();
    clockAnswer = () => Date.now() + 42_000;
    await expect(fetchApiClubNames()).resolves.toEqual(['Club A']);
    await flushMicrotasks();
    expect(clockCalls()).toHaveLength(2);
    expect(getServerClockSample()).toEqual({ skewMs: 42_000, sampledAt: T0 + SAMPLE_TIMEOUT_MS });
  });

  it('discards a sample whose round trip took longer than 5s, and keeps one of exactly 5s', async () => {
    const MAX_ROUND_TRIP_MS = 5000;
    jest.useFakeTimers({ now: T0 });
    let clock = deferred<number>();
    const { clockCalls } = installTransport(answer(['Club A']), () => clock.promise);

    await expect(fetchApiClubNames()).resolves.toEqual(['Club A']);
    jest.advanceTimersByTime(MAX_ROUND_TRIP_MS + 1);
    clock.resolve(Date.now() + 60_000);
    await flushMicrotasks();
    expect(getServerClockSample()).toBeNull();

    const sentAt = Date.now();
    clock = deferred<number>();
    await fetchApiClubNames();
    jest.advanceTimersByTime(MAX_ROUND_TRIP_MS);
    clock.resolve(Date.now() + 60_000);
    await flushMicrotasks();
    expect(clockCalls()).toHaveLength(2);
    expect(getServerClockSample()).toEqual({
      skewMs: 60_000 + MAX_ROUND_TRIP_MS / 2,
      sampledAt: sentAt + MAX_ROUND_TRIP_MS,
    });
  });

  describe('awaitServerClock', () => {
    it('answers with the sample at hand without asking again', async () => {
      jest.useFakeTimers({ now: T0 });
      const { clockCalls } = installTransport(answer([]), () => T0 + 5000);
      await fetchApiClubNames();
      await flushMicrotasks();
      expect(clockCalls()).toHaveLength(1);

      await expect(awaitServerClock()).resolves.toEqual({ skewMs: 5000, sampledAt: T0 });
      expect(clockCalls()).toHaveLength(1);
    });

    it('joins the sample a request started, and has it as soon as it lands', async () => {
      jest.useFakeTimers({ now: T0 });
      const clock = deferred<number>();
      const { clockCalls } = installTransport(answer(['Club A']), () => clock.promise);
      await fetchApiClubNames();

      let sample: unknown = 'pending';
      void awaitServerClock().then((value) => {
        sample = value;
      });
      await flushMicrotasks();
      expect(sample).toBe('pending');

      clock.resolve(T0 + 7000);
      await flushMicrotasks();
      expect(sample).toEqual({ skewMs: 7000, sampledAt: T0 });
      expect(clockCalls()).toHaveLength(1);
    });

    it('starts a sample when none is in flight', async () => {
      jest.useFakeTimers({ now: T0 });
      const { clockCalls, dataCalls } = installTransport(answer([]), () => T0 - 2000);

      await expect(awaitServerClock()).resolves.toEqual({ skewMs: -2000, sampledAt: T0 });
      expect(clockCalls()).toHaveLength(1);
      expect(dataCalls()).toHaveLength(0);
    });

    it('gives up after its grace period on a clock call that never answers', async () => {
      jest.useFakeTimers({ now: T0 });
      installTransport(answer([]), () => never());
      let settled = false;
      const pending = awaitServerClock().finally(() => {
        settled = true;
      });

      await flushMicrotasks();
      jest.advanceTimersByTime(SERVER_CLOCK_DECISION_GRACE_MS - 1);
      await flushMicrotasks();
      expect(settled).toBe(false);

      jest.advanceTimersByTime(1);
      await expect(pending).resolves.toBeNull();
    });
  });
});
