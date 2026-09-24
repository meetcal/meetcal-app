import { loadAthleteResults, type AthleteResultsLoad } from '@/lib/athlete-results-load';
import type { SupabaseLiftResult } from '@/types/athlete-results';

function row(meet: string): SupabaseLiftResult {
  return { meet, name: 'Jane Lifter', date: '2026-06-20', total: 200 } as unknown as SupabaseLiftResult;
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
  const painted: { source: 'offline' | 'api'; meets: string[] }[] = [];
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
    const offline = deferred<SupabaseLiftResult[]>();
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
    const offline = deferred<SupabaseLiftResult[]>();
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
    await loadAthleteResults(load);
    expect(painted).toEqual([{ source: 'offline', meets: ['Local'] }]);
  });

  it('shows an empty API answer when nothing else was shown', async () => {
    const { load, painted } = makeLoad();
    await loadAthleteResults(load);
    expect(painted).toEqual([{ source: 'api', meets: [] }]);
  });

  it('keeps the on-device rows when the request fails, and never rejects', async () => {
    const full = deferred<SupabaseLiftResult[]>();
    const offline = deferred<SupabaseLiftResult[]>();
    const { load, painted } = makeLoad({
      readOffline: () => offline.promise,
      fetchFull: () => full.promise,
    });
    const done = loadAthleteResults(load);
    // Rejects while the on-device read is still running.
    full.reject(new Error('offline'));
    await Promise.resolve();
    offline.resolve([row('Local')]);
    await expect(done).resolves.toBeUndefined();
    expect(painted).toEqual([{ source: 'offline', meets: ['Local'] }]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs a failed request when there was nothing to show', async () => {
    const { load, painted } = makeLoad({
      fetchFull: async () => {
        throw new Error('offline');
      },
    });
    await loadAthleteResults(load);
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
    await loadAthleteResults(load);
    expect(readOffline).not.toHaveBeenCalled();
    // Empty answer over already-shown rows: nothing repainted.
    expect(painted).toEqual([]);
  });

  it('paints nothing once the screen has moved on', async () => {
    let current = true;
    const offline = deferred<SupabaseLiftResult[]>();
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
    const full = deferred<SupabaseLiftResult[]>();
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
    const full = deferred<SupabaseLiftResult[]>();
    const { load, painted } = makeLoad({ fetchFull: () => full.promise, isCurrent: () => current });
    const done = loadAthleteResults(load);
    current = false;
    full.reject(new Error('offline'));
    await done;
    expect(painted).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });
});
