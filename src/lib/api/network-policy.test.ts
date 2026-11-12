import {
  isRetryableReadFailure,
  READ_MAX_ATTEMPTS,
  READ_RETRY_MAX_DELAY_MS,
  readRetryDelayMs,
  startInactivityTimer,
  withReadRetries,
} from './network-policy';

describe('startInactivityTimer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires after the limit passes with no progress', () => {
    const onSilence = jest.fn();
    startInactivityTimer(1000, onSilence);
    jest.advanceTimersByTime(999);
    expect(onSilence).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it('never fires while progress keeps arriving, however long the transfer runs', () => {
    const onSilence = jest.fn();
    const timer = startInactivityTimer(1000, onSilence);
    for (let second = 0; second < 60; second += 1) {
      jest.advanceTimersByTime(900);
      timer.touch();
    }
    expect(onSilence).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it('stays quiet once stopped, and a touch after firing does not rearm it', () => {
    const stoppedSilence = jest.fn();
    const stopped = startInactivityTimer(1000, stoppedSilence);
    stopped.stop();
    jest.advanceTimersByTime(5000);
    expect(stoppedSilence).not.toHaveBeenCalled();

    const firedSilence = jest.fn();
    const fired = startInactivityTimer(1000, firedSilence);
    jest.advanceTimersByTime(1000);
    fired.touch();
    jest.advanceTimersByTime(5000);
    expect(firedSilence).toHaveBeenCalledTimes(1);
  });
});

describe('readRetryDelayMs', () => {
  it('grows with each failed attempt and stays inside the cap', () => {
    expect(readRetryDelayMs(1, () => 1)).toBe(1000);
    expect(readRetryDelayMs(2, () => 1)).toBe(2000);
    expect(readRetryDelayMs(3, () => 1)).toBe(4000);
    expect(readRetryDelayMs(9, () => 1)).toBe(READ_RETRY_MAX_DELAY_MS);
    expect(readRetryDelayMs(1, () => 0)).toBe(500);
  });

  it('never leaves [0, READ_RETRY_MAX_DELAY_MS] for any random value', () => {
    for (const random of [0, 0.25, 0.5, 0.999, 1, -1, 2]) {
      for (let attempt = -1; attempt < 12; attempt += 1) {
        const delay = readRetryDelayMs(attempt, () => random);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(READ_RETRY_MAX_DELAY_MS);
      }
    }
  });
});

describe('isRetryableReadFailure', () => {
  it.each([
    [{ status: null, timedOut: true }, true],
    [{ status: null, timedOut: false }, true],
    [{ status: 408, timedOut: false }, true],
    [{ status: 429, timedOut: false }, true],
    [{ status: 503, timedOut: false }, true],
    [{ status: 400, timedOut: false }, false],
    [{ status: 401, timedOut: false }, false],
    [{ status: 404, timedOut: false }, false],
    [{ status: 500, timedOut: false }, false],
  ])('%j -> %s', (facts, expected) => {
    expect(isRetryableReadFailure(facts)).toBe(expected);
  });
});

describe('withReadRetries', () => {
  const networkDown = { status: null, timedOut: false };
  const notFound = { status: 404, timedOut: false };
  const noWait = () => Promise.resolve();

  it('retries a network failure and answers with the first success', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('rows');
    const wait = jest.fn(noWait);
    await expect(
      withReadRetries(run, { classify: () => networkDown, isOnline: async () => true, wait, random: () => 1 }),
    ).resolves.toBe('rows');
    expect(run).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1000);
  });

  it(`gives up after ${READ_MAX_ATTEMPTS} attempts with the last failure`, async () => {
    const failures = [new Error('one'), new Error('two'), new Error('three')];
    const run = jest.fn(async () => {
      throw failures.shift();
    });
    await expect(
      withReadRetries(run, { classify: () => networkDown, isOnline: async () => true, wait: noWait }),
    ).rejects.toThrow('three');
    expect(run).toHaveBeenCalledTimes(READ_MAX_ATTEMPTS);
  });

  it('fails at once on an answer a retry cannot change', async () => {
    const run = jest.fn().mockRejectedValue(new Error('not found'));
    await expect(
      withReadRetries(run, { classify: () => notFound, isOnline: async () => true, wait: noWait }),
    ).rejects.toThrow('not found');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('fails at once while the device is offline, before and after the wait', async () => {
    const offlineRun = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(
      withReadRetries(offlineRun, { classify: () => networkDown, isOnline: async () => false, wait: noWait }),
    ).rejects.toThrow('offline');
    expect(offlineRun).toHaveBeenCalledTimes(1);

    const online = [true, false];
    const droppedRun = jest.fn().mockRejectedValue(new Error('dropped'));
    await expect(
      withReadRetries(droppedRun, {
        classify: () => networkDown,
        isOnline: async () => online.shift() ?? false,
        wait: noWait,
      }),
    ).rejects.toThrow('dropped');
    expect(droppedRun).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying when the network check itself fails', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('rows');
    await expect(
      withReadRetries(run, {
        classify: () => networkDown,
        isOnline: () => Promise.reject(new Error('netinfo')),
        wait: noWait,
      }),
    ).resolves.toBe('rows');
  });
});
