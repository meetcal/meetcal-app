import { describeFailure } from '../../convex/lib/cronAlerts';
import { ROLLING_NIGHTS } from '../../convex/scrapers/parse/sport80';
import { run } from '../../convex/scrapers/sport80';
import { handlerOf } from '../fakeDb';

const API = 'https://rankings.example.test';
const NOW = Date.UTC(2026, 10, 11, 6, 5);
const tonight = Math.floor(NOW / 86_400_000) % ROLLING_NIGHTS;
const olderId = [901, 902, 903].find((id) => id % ROLLING_NIGHTS !== tonight) ?? 901;
const event = (id: number, date: string) => ({ meet: `Meet ${id}`, start_date: date, action: [{ route: `/events/${id}` }] });
const recentEvents = Array.from({ length: 31 }, (_, i) => event(i + 1, `2026-10-${String(i + 1).padStart(2, '0')}`));
const olderEvent = event(olderId, '2025-03-01');
const lifter = { lifter: 'Ann Lee', age_category: "Open Women's 63kg", body_weight_kg: 62, snatch_lift_1: 80, snatch_lift_2: 82, snatch_lift_3: -84, best_snatch: 82, cj_lift_1: 100, cj_lift_2: 102, cj_lift_3: -104, best_cj: 102, total: 184 };
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async (): Promise<string> => JSON.stringify(body) });
const originalFetch = global.fetch;

function sport80(unreadableYears: readonly string[] = [], emptyTables: readonly string[] = []) {
  const read: string[] = [];
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    if (url.endsWith('/public/rankings/')) {
      return { ok: true, status: 200, text: async (): Promise<string> => `<script>window.env = {"RANKINGS_DOMAIN_URL":"${API}","SERVICES_API_PUBLIC_KEY":"key"};</script>` };
    }
    const path = new URL(url).pathname;
    if (path === '/api/events/table/data') {
      const payload: unknown = JSON.parse(init?.body ?? '{}');
      const year = typeof payload === 'object' && payload !== null && 'date_range_start' in payload ? String(payload.date_range_start).slice(0, 4) : '';
      if (unreadableYears.includes(year)) return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
      const data = year === '2026' ? recentEvents : [olderEvent];
      return json({ data, total: data.length });
    }
    const eventId = /\/api\/events\/(\d+)\/table\/data/.exec(path)?.[1] ?? '';
    read.push(eventId);
    const rows = emptyTables.includes(eventId) ? [] : [lifter];
    return json({ data: rows, total: rows.length });
  }) as never;
  return read;
}

function deployment(failedLastRun: string[], args: { only?: string[]; continuing?: string[] } = {}) {
  const ctx = {
    runQuery: async (): Promise<string[]> => failedLastRun,
    runMutation: async () => ({ inserted: 1, updated: 0, unchanged: 0, deleted: 0, remaining: 0 }),
  };
  return handlerOf<{ only?: string[]; continuing?: string[] }>(run)(ctx, args).then(
    () => ({ error: '', failedSources: [] as string[] }),
    (error: unknown) => ({ failedSources: [] as string[], ...describeFailure(error) }),
  );
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  for (const method of ['error', 'log', 'warn'] as const) jest.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('reading again the events the last run named as failing (#566)', () => {
  it('reads a failing older event again although it is not due on the rolling pass tonight', async () => {
    const read = sport80();
    expect((await deployment([`Meet ${olderId} (event ${olderId})`])).failedSources).toEqual([]);
    expect(read).toContain(String(olderId));
    const notRetried = sport80();
    await deployment([]);
    expect(notRetried).not.toContain(String(olderId));
  });

  it('stops naming a failing event that neither event index lists when both were read', async () => {
    sport80();
    expect((await deployment(['event 424242'])).failedSources).toEqual([]);
  });

  it('names a failing event under the name it already had when its event index cannot be read', async () => {
    sport80(['2025']);
    const { failedSources } = await deployment([`Meet ${olderId} (event ${olderId})`]);
    expect(failedSources).toEqual(['event index 2025', `Meet ${olderId} (event ${olderId})`].sort());
  });

  it('still names the failing events when no event index can be read', async () => {
    sport80(['2025', '2026']);
    const { error, failedSources } = await deployment([`Meet ${olderId} (event ${olderId})`]);
    expect(error).toContain('no events fetched');
    expect(failedSources).toContain(`Meet ${olderId} (event ${olderId})`);
  });

  it('names the events a run was asked for when no event index can be read (#622)', async () => {
    sport80(['2025', '2026']);
    const { failedSources } = await deployment([], { only: [String(olderId)] });
    expect(failedSources).toContain(`event ${olderId}`);
  });

  it('reads the sources a continuation was sent to reach, under their names, and lets an empty table pass as a night does (#622)', async () => {
    const read = sport80();
    const source = `Meet ${olderId} (event ${olderId})`;
    expect((await deployment([], { continuing: [source] })).failedSources).toEqual([]);
    expect(read).toEqual([String(olderId)]);
    sport80([], [String(olderId)]);
    expect((await deployment([], { continuing: [source] })).failedSources).toEqual([]);
    sport80([], [String(olderId)]);
    expect((await deployment([], { only: [String(olderId)] })).failedSources).toEqual([`event ${olderId}`]);
    sport80(['2025', '2026']);
    expect((await deployment([], { continuing: [source] })).failedSources).toContain(source);
  });
});
