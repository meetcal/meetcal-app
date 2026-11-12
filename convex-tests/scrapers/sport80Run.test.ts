import { getFunctionName } from 'convex/server';
import { describeFailure } from '../../convex/lib/cronAlerts';
import { HARD_STOP_MS, NOT_REACHED, OUT_OF_TIME, RUN_BUDGET_MS } from '../../convex/scrapers/lib/budget';
import { run } from '../../convex/scrapers/sport80';
import { handlerOf } from '../fakeDb';
import { itemAt } from '../../convex/lib/json';

const API = 'https://rankings.example.test';
const events = ['1', '2'].map((id) => ({ meet: `Meet ${id}`, start_date: `2026-10-0${id}`, action: [{ route: `/events/${id}` }] }));
const lifter = { lifter: 'Ann Lee', age_category: "Open Women's 63kg", body_weight_kg: 62, snatch_lift_1: 80, snatch_lift_2: 82, snatch_lift_3: -84, best_snatch: 82, cj_lift_1: 100, cj_lift_2: 102, cj_lift_3: -104, best_cj: 102, total: 184 };
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async (): Promise<string> => JSON.stringify(body) });
const originalFetch = global.fetch;

function sport80(onEventRead: (eventId: string) => void | Promise<unknown> = () => {}, rowsOf: (eventId: string) => unknown[] = () => [lifter]) {
  global.fetch = jest.fn(async (url: string) => {
    if (url.endsWith('/public/rankings/')) {
      return { ok: true, status: 200, text: async (): Promise<string> => `<script>window.env = {"RANKINGS_DOMAIN_URL":"${API}","SERVICES_API_PUBLIC_KEY":"key"};</script>` };
    }
    const path = new URL(url).pathname;
    if (path === '/api/events/table/data') return json({ data: events, total: events.length });
    const eventId = itemAt(/\/api\/events\/(\d+)\/table\/data/.exec(path) ?? [], 1);
    await onEventRead(eventId);
    const rows = rowsOf(eventId);
    return json({ data: rows, total: rows.length });
  }) as never;
}

function deployment(afterStoring: (meet: string) => void = () => {}) {
  const storedMeets: string[] = [];
  const prunedEvents: string[] = [];
  const ctx = {
    runQuery: async (): Promise<string[]> => [],
    runMutation: async (ref: unknown, args: { rows?: { meet: string }[]; eventId?: string }) => {
      if (getFunctionName(ref as never) === 'ingest:pruneEventResults') {
        prunedEvents.push(args.eventId!);
        return { deleted: 0, remaining: 0 };
      }
      const meet = itemAt(args.rows ?? [], 0).meet;
      storedMeets.push(meet);
      afterStoring(meet);
      return { inserted: 1, updated: 0, unchanged: 0 };
    },
  };
  const failure = () => handlerOf<Record<string, never>>(run)(ctx, {}).then(() => ({ error: '', failedSources: [] as string[] }), (error: unknown) => ({ failedSources: [], ...describeFailure(error) }));
  return { storedMeets, prunedEvents, failure };
}

beforeEach(() => {
  jest.useFakeTimers({ now: Date.UTC(2026, 10, 11, 6, 5) });
  for (const method of ['error', 'log', 'warn'] as const) jest.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the Sport80 results run's time budget (#574)", () => {
  it('stores and prunes every event when the run stays inside its budget', async () => {
    sport80();
    const { storedMeets, prunedEvents, failure } = deployment();
    expect((await failure()).failedSources).toEqual([]);
    expect(storedMeets).toEqual(['Meet 2', 'Meet 1']);
    expect(prunedEvents).toEqual(['2', '1']);
  });

  it('stops reading events at half its budget, stores what it read, and names the events it did not read', async () => {
    sport80((eventId) => {
      if (eventId === '2') jest.advanceTimersByTime(RUN_BUDGET_MS / 2);
    });
    const { storedMeets, failure } = deployment();
    const { error, failedSources } = await failure();
    expect(storedMeets).toEqual(['Meet 2']);
    expect(failedSources).toEqual(['Meet 1 (event 1)']);
    expect(error).toContain(`Meet 1 (event 1): ${NOT_REACHED}`);
  });

  it('stops waiting for an event read at three quarters of its budget, so the events read before it are still stored', async () => {
    sport80((eventId) => (eventId === '2' ? void jest.advanceTimersByTime(200_000) : new Promise(() => {})));
    const { storedMeets, failure } = deployment();
    const outcome = failure();
    await jest.advanceTimersByTimeAsync(RUN_BUDGET_MS);
    const { error, failedSources } = await outcome;
    expect(storedMeets).toEqual(['Meet 2']);
    expect(failedSources).toEqual(['Meet 1 (event 1)']);
    expect(error).toContain('1 of 1 meet(s) read were stored');
    expect(error).toContain(OUT_OF_TIME);
  });

  it('does not count a meet whose rows were all unreadable among the meets stored', async () => {
    sport80(() => {}, (eventId) => (eventId === '1' ? [{ ...lifter, lifter: '' }] : [lifter]));
    const { storedMeets, failure } = deployment();
    const { error } = await failure();
    expect(storedMeets).toEqual(['Meet 2']);
    expect(error).toContain('1 of 2 meet(s) read were stored');
  });

  it('names an event it read but ran out of time to store, and does not prune it', async () => {
    sport80();
    const slowFirstStore = (meet: string) => {
      if (meet === 'Meet 2') jest.advanceTimersByTime(RUN_BUDGET_MS);
    };
    const { storedMeets, prunedEvents, failure } = deployment(slowFirstStore);
    const { error, failedSources } = await failure();
    expect(storedMeets).toEqual(['Meet 2']);
    expect(prunedEvents).toEqual(['2']);
    expect(failedSources).toEqual(['Meet 1 (event 1)']);
    expect(error).toContain(`Meet 1 (event 1): read but not stored: ${NOT_REACHED}`);
  });

  it('writes nothing more once the hard stop has passed, even for an event it had started storing', async () => {
    sport80();
    const storePastTheHardStop = (meet: string) => {
      if (meet === 'Meet 2') jest.advanceTimersByTime(HARD_STOP_MS);
    };
    const { prunedEvents, failure } = deployment(storePastTheHardStop);
    const { error } = await failure();
    expect(prunedEvents).toEqual([]);
    expect(error).toContain(`Meet 2 (event 2): stale results not deleted: ${OUT_OF_TIME}`);
  });

  it('stops storing an event part way when the hard stop passes between its batches', async () => {
    const twoBatches = Array.from({ length: 201 }, (_, i) => ({ ...lifter, lifter: `Lifter ${i}` }));
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/public/rankings/')) return { ok: true, status: 200, text: async (): Promise<string> => `<script>window.env = {"RANKINGS_DOMAIN_URL":"${API}","SERVICES_API_PUBLIC_KEY":"key"};</script>` };
      return new URL(url).pathname === '/api/events/table/data' ? json({ data: [events[1]], total: 1 }) : json({ data: twoBatches, total: twoBatches.length });
    }) as never;
    const { storedMeets, prunedEvents, failure } = deployment(() => jest.advanceTimersByTime(HARD_STOP_MS));
    const { error } = await failure();
    expect(storedMeets).toEqual(['Meet 2']);
    expect(prunedEvents).toEqual([]);
    expect(error).toContain(`Meet 2 (event 2): not stored: ${OUT_OF_TIME}`);
  });

  it('fails as the event index, not as a stopped action, when the index is still loading at the hard stop', async () => {
    global.fetch = jest.fn(async (url: string) =>
      url.endsWith('/public/rankings/')
        ? { ok: true, status: 200, text: async (): Promise<string> => `<script>window.env = {"RANKINGS_DOMAIN_URL":"${API}","SERVICES_API_PUBLIC_KEY":"key"};</script>` }
        : new Promise(() => {}),
    ) as never;
    const { failure } = deployment();
    const run = failure();
    await jest.advanceTimersByTimeAsync(HARD_STOP_MS);
    const { error } = await run;
    expect(error).toContain(`event index 2026: ${OUT_OF_TIME}`);
    expect(error).toContain(`event index 2025: ${OUT_OF_TIME}`);
  });
});
