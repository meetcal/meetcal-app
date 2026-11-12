import {
  canRetryFullHistory,
  loadAthleteResults,
  partialResultsStatus,
  showsCareerStats,
  type AthleteResultsLoad,
  type ShownResultsSource,
} from '@/lib/athlete-results-load';
import type { AthleteMeetResult } from '@/types/athlete-results';

function row(meet: string): AthleteMeetResult {
  return { meet, name: 'Jane Lifter', date: '2026-06-20', total: 200 } as unknown as AthleteMeetResult;
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

function makeLoad(overrides: Partial<AthleteResultsLoad> = {}) {
  const painted: { source: ShownResultsSource; meets: string[] }[] = [];
  const load: AthleteResultsLoad = {
    shown: undefined,
    readOffline: jest.fn(async () => []),
    fetchFull: jest.fn(async () => []),
    isCurrent: () => true,
    show: (rows, source) => painted.push({ source, meets: rows.map((r) => r.meet) }),
    ...overrides,
  };
  return { load, painted };
}

describe('loadAthleteResults', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The on-device read scans every downloaded meet's stored results for an
  // athlete with no history blob; the request used to wait behind it.
  it('sends the API request before the on-device read finishes', async () => {
    const offline = deferred<AthleteMeetResult[]>();
    const fetchFull = jest.fn(async () => [row('API')]);
    const { load, painted } = makeLoad({ readOffline: () => offline.promise, fetchFull });

    const done = loadAthleteResults(load);
    expect(fetchFull).toHaveBeenCalledTimes(1);

    offline.resolve([row('Local')]);
    await done;
    expect(painted).toEqual([
      { source: 'offline', meets: ['Local'] },
      { source: 'api', meets: ['API'] },
    ]);
  });

  it('paints the on-device rows first even when the API answered first', async () => {
    const offline = deferred<AthleteMeetResult[]>();
    const { load, painted } = makeLoad({
      readOffline: () => offline.promise,
      fetchFull: async () => [row('API')],
    });
    const done = loadAthleteResults(load);
    await Promise.resolve();
    offline.resolve([row('Local')]);
    await done;
    // The API rows always land last, so they are what stays on screen.
    expect(painted).toEqual([
      { source: 'offline', meets: ['Local'] },
      { source: 'api', meets: ['API'] },
    ]);
  });

  it('does not let an empty API answer clobber on-device rows', async () => {
    const { load, painted } = makeLoad({
      readOffline: async () => [row('Local')],
      fetchFull: async () => [],
    });
    // What stays on screen is still only the on-device copy.
    await expect(loadAthleteResults(load)).resolves.toBe('offline-partial');
    expect(painted).toEqual([{ source: 'offline', meets: ['Local'] }]);
  });

  it('shows an empty API answer when nothing else was shown', async () => {
    const { load, painted } = makeLoad();
    await expect(loadAthleteResults(load)).resolves.toBe('shown');
    expect(painted).toEqual([{ source: 'api', meets: [] }]);
  });

  // Regression (#312): this returned 'shown', so the screen presented one
  // cached meet as the whole career, PR badges and success rates included.
  it('keeps the on-device rows when the request fails, says they are partial, and never rejects', async () => {
    const full = deferred<AthleteMeetResult[]>();
    const offline = deferred<AthleteMeetResult[]>();
    const { load, painted } = makeLoad({
      readOffline: () => offline.promise,
      fetchFull: () => full.promise,
    });
    const done = loadAthleteResults(load);
    // Rejects while the on-device read is still running.
    full.reject(new Error('offline'));
    await Promise.resolve();
    offline.resolve([row('Local')]);
    await expect(done).resolves.toBe('offline-partial');
    expect(painted).toEqual([{ source: 'offline', meets: ['Local'] }]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs a failed request when there was nothing to show', async () => {
    const { load, painted } = makeLoad({
      fetchFull: async () => {
        throw new Error('offline');
      },
    });
    await expect(loadAthleteResults(load)).resolves.toBe('failed');
    expect(painted).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('falls through to the API when the on-device read throws', async () => {
    const { load, painted } = makeLoad({
      readOffline: async () => {
        throw new Error('corrupt');
      },
      fetchFull: async () => [row('API')],
    });
    await loadAthleteResults(load);
    expect(painted).toEqual([{ source: 'api', meets: ['API'] }]);
  });

  it('skips the on-device read when the screen already holds rows', async () => {
    const readOffline = jest.fn(async () => [row('Local')]);
    const { load, painted } = makeLoad({
      shown: [row('Memo')],
      readOffline,
      fetchFull: async () => [],
    });
    await expect(loadAthleteResults(load)).resolves.toBe('shown');
    expect(readOffline).not.toHaveBeenCalled();
    // Empty answer over already-shown rows: nothing repainted.
    expect(painted).toEqual([]);
  });

  it('keeps rows the API already answered complete when a later request fails', async () => {
    const { load, painted } = makeLoad({
      shown: [row('Memo')],
      fetchFull: async () => {
        throw new Error('offline');
      },
    });
    await expect(loadAthleteResults(load)).resolves.toBe('shown');
    expect(painted).toEqual([]);
  });

  // A Retry over on-device rows re-read the device and, finding nothing (the
  // download was removed meanwhile), let an empty answer clear the rows, or
  // a failed request report "failed" and lose the Retry.
  it.each([
    ['answers empty', async () => []],
    [
      'fails',
      async () => {
        throw new Error('offline');
      },
    ],
  ])('keeps on-device rows kept through a retry as partial when the request %s', async (_label, fetchFull) => {
    const { load, painted } = makeLoad({
      shown: [row('Local')],
      shownSource: 'offline',
      readOffline: jest.fn(async () => []),
      fetchFull,
    });
    await expect(loadAthleteResults(load)).resolves.toBe('offline-partial');
    expect(painted).toEqual([]);
  });

  it('paints nothing once the screen has moved on', async () => {
    let current = true;
    const offline = deferred<AthleteMeetResult[]>();
    const { load, painted } = makeLoad({
      readOffline: () => offline.promise,
      fetchFull: async () => [row('API')],
      isCurrent: () => current,
    });
    const done = loadAthleteResults(load);
    current = false;
    offline.resolve([row('Local')]);
    await done;
    expect(painted).toEqual([]);
  });

  it('paints nothing more when the screen moves on while the request is in flight', async () => {
    let current = true;
    const full = deferred<AthleteMeetResult[]>();
    const { load, painted } = makeLoad({
      readOffline: async () => [row('Local')],
      fetchFull: () => full.promise,
      isCurrent: () => current,
    });
    const done = loadAthleteResults(load);
    await new Promise((r) => setTimeout(r, 0));
    expect(painted).toEqual([{ source: 'offline', meets: ['Local'] }]);

    current = false;
    full.resolve([row('Previous athlete API')]);
    await done;
    expect(painted).toEqual([{ source: 'offline', meets: ['Local'] }]);
  });

  it('does not log a failure for a screen that has moved on', async () => {
    let current = true;
    const full = deferred<AthleteMeetResult[]>();
    const { load, painted } = makeLoad({ fetchFull: () => full.promise, isCurrent: () => current });
    const done = loadAthleteResults(load);
    current = false;
    full.reject(new Error('offline'));
    await expect(done).resolves.toBe('superseded');
    expect(painted).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('showsCareerStats', () => {
  it('trusts PRs and success rates computed from a whole history, fresh or saved', () => {
    expect(showsCareerStats('api')).toBe(true);
    expect(showsCareerStats('saved')).toBe(true);
    expect(showsCareerStats('offline')).toBe(false);
    expect(showsCareerStats(null)).toBe(false);
  });
});

describe('canRetryFullHistory', () => {
  it('offers a retry whenever the full history did not load', () => {
    expect(canRetryFullHistory('offline-partial')).toBe(true);
    expect(canRetryFullHistory('kept-stale')).toBe(true);
    expect(canRetryFullHistory('failed')).toBe(true);
    expect(canRetryFullHistory('shown')).toBe(false);
    expect(canRetryFullHistory(null)).toBe(false);
  });
});

describe('partialResultsStatus', () => {
  it('says nothing over the API history', () => {
    expect(partialResultsStatus({ source: 'api', outcome: 'offline-partial', isOffline: true })).toBeNull();
    expect(partialResultsStatus({ source: null, outcome: null, isOffline: true })).toBeNull();
  });

  it('says the full history is still loading behind on-device rows', () => {
    expect(partialResultsStatus({ source: 'offline', outcome: null, isOffline: false })).toMatch(/Loading full history/);
  });

  it('matches the attempt estimator when offline', () => {
    expect(partialResultsStatus({ source: 'offline', outcome: 'offline-partial', isOffline: true }))
      .toMatch(/^Offline\. Showing downloaded data/);
  });

  it('says nothing over a saved history while it refreshes or once it refreshed', () => {
    expect(partialResultsStatus({ source: 'saved', outcome: null, isOffline: false })).toBeNull();
    expect(partialResultsStatus({ source: 'saved', outcome: 'shown', isOffline: false })).toBeNull();
  });

  it('says a saved history may be out of date once its refresh failed', () => {
    expect(partialResultsStatus({ source: 'saved', outcome: 'kept-stale', isOffline: false })).toBe(
      'Full history unavailable. Showing the history saved on this device, which may be out of date.',
    );
    expect(partialResultsStatus({ source: 'saved', outcome: 'kept-stale', isOffline: true }))
      .toMatch(/^Offline\. Showing the history saved on this device/);
  });

  it('says the full history is unavailable when online', () => {
    expect(partialResultsStatus({ source: 'offline', outcome: 'offline-partial', isOffline: false }))
      .toMatch(/^Full history unavailable\. Showing downloaded data/);
  });
});

describe('loadAthleteResults with a browsed copy', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('paints the history saved on an earlier visit, and keeps it as possibly stale when the request fails', async () => {
    const readOffline = jest.fn(async () => [row('Downloaded')]);
    const { load, painted } = makeLoad({
      readBrowsed: async () => [row('Kept A'), row('Kept B')],
      readOffline,
      fetchFull: async () => {
        throw new Error('Network request failed');
      },
    });
    await expect(loadAthleteResults(load)).resolves.toBe('kept-stale');
    expect(painted).toEqual([{ source: 'saved', meets: ['Kept A', 'Kept B'] }]);
    expect(readOffline).not.toHaveBeenCalled();
  });

  it('keeps a saved history on screen through a retry, and replaces it once the request answers', async () => {
    const readBrowsed = jest.fn(async () => [row('Kept')]);
    const { load, painted } = makeLoad({
      shown: [row('Kept')],
      shownSource: 'saved',
      readBrowsed,
      fetchFull: async () => [row('Fresh')],
    });
    await expect(loadAthleteResults(load)).resolves.toBe('shown');
    expect(readBrowsed).not.toHaveBeenCalled();
    expect(painted).toEqual([{ source: 'api', meets: ['Fresh'] }]);
  });

  it('keeps a saved history as possibly stale when the request answers empty over it', async () => {
    const { load } = makeLoad({ readBrowsed: async () => [row('Kept')], fetchFull: async () => [] });
    await expect(loadAthleteResults(load)).resolves.toBe('kept-stale');
  });

  it('replaces the kept history with the answer and keeps the answer for next time', async () => {
    const rememberFull = jest.fn(async () => {});
    const { load, painted } = makeLoad({
      readBrowsed: async () => [row('Kept')],
      rememberFull,
      fetchFull: async () => [row('Fresh')],
    });
    await expect(loadAthleteResults(load)).resolves.toBe('shown');
    expect(painted.map((paint) => paint.meets)).toEqual([['Kept'], ['Fresh']]);
    expect(rememberFull).toHaveBeenCalledWith([row('Fresh')]);
  });

  it('falls back to the downloaded rows when nothing was kept, and never keeps an empty answer', async () => {
    const rememberFull = jest.fn(async () => {});
    const { load, painted } = makeLoad({
      readBrowsed: async () => {
        throw new Error('storage');
      },
      rememberFull,
      readOffline: async () => [row('Downloaded')],
      fetchFull: async () => [],
    });
    await expect(loadAthleteResults(load)).resolves.toBe('offline-partial');
    expect(painted).toEqual([{ source: 'offline', meets: ['Downloaded'] }]);
    expect(rememberFull).not.toHaveBeenCalled();
  });

  it('shows the answer even when keeping it fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { load, painted } = makeLoad({
      readBrowsed: async () => null,
      rememberFull: async () => {
        throw new Error('disk full');
      },
      fetchFull: async () => [row('Fresh')],
    });
    await expect(loadAthleteResults(load)).resolves.toBe('shown');
    expect(painted).toEqual([{ source: 'api', meets: ['Fresh'] }]);
  });
});
