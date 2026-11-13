import { getFunctionName } from 'convex/server';
import { describeFailure } from '../../convex/lib/cronAlerts';
import { run } from '../../convex/scrapers/entries';
import { HARD_STOP_MS, NOT_REACHED, OUT_OF_TIME, RUN_BUDGET_MS } from '../../convex/scrapers/lib/budget';
import { fetchJson } from '../../convex/scrapers/lib/http';
import { handlerOf } from '../fakeDb';

jest.mock('../../convex/scrapers/lib/http', () => ({ ...jest.requireActual('../../convex/scrapers/lib/http'), fetchJson: jest.fn() }));

const targets = ['A', 'B', 'C'].map((label, i) => ({ label: `Meet ${label}`, url: `https://usaweightlifting.sport80.com/public/events/${100 + i}/entries/${200 + i}` }));
const entrant = { id: 1, member_id: '1000001', first_name: 'Ann', last_name: 'Lee', weightlifting_age: 30, club: 'Club', gender: 'Female', weight_class: '63', entry_total: 150 };
const meetOf = (url: string) => targets.find((target) => url.includes(`/datatable/${/events\/(\d+)/.exec(target.url)![1]}/`))!.label;

function deployment(afterStoring: (meet: string) => void = () => {}) {
  const stored: string[] = [];
  const listed: [string, number][] = [];
  const ctx = {
    runQuery: async (ref: unknown, args: { title?: string }) => {
      const name = getFunctionName(ref as never);
      if (name === 'scrapers/entryTargets:list') return targets;
      if (name === 'scrapers/queries:entriesMeet') return { name: args.title, status: 'upcoming', endDate: '2099-01-01' };
      return {};
    },
    runMutation: async (ref: unknown, args: { meet: string; rows?: unknown[] }) => {
      if (getFunctionName(ref as never) === 'ingest:recordSport80Entrants') {
        listed.push([args.meet, args.rows?.length ?? 0]);
        return { published: false, inserted: 0, updated: 0, deleted: 0 };
      }
      stored.push(args.meet);
      afterStoring(args.meet);
      return { inserted: 1, updated: 0, unchanged: 0, sessionSkipped: 0, notOnStartList: 0, rejected: 0, deleted: 0 };
    },
  };
  const failedSources = () =>
    handlerOf<Record<string, never>>(run)(ctx, {}).then(
      () => [] as string[],
      (error: unknown) => describeFailure(error).failedSources ?? [],
    );
  const failureText = () => handlerOf<Record<string, never>>(run)(ctx, {}).then(() => '', (error: unknown) => describeFailure(error).error);
  const unreached = () =>
    handlerOf<Record<string, never>>(run)(ctx, {}).then(
      () => [] as string[],
      (error: unknown) => (describeFailure(error).failures ?? []).filter((f) => f.notReached).map((f) => f.source),
    );
  const dryRun = () => handlerOf<{ dryRun: boolean }, { label: string; meet?: string; error?: string }[]>(run)(ctx, { dryRun: true });
  return { stored, listed, failedSources, failureText, unreached, dryRun };
}

beforeEach(() => {
  jest.useFakeTimers({ now: Date.UTC(2026, 10, 11, 7, 25) });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(fetchJson).mockImplementation(async (url: string) => (url.includes('?') ? { total: 1, data: [entrant] } : { title: `${meetOf(url)} - Members` }));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('a dry run of the entries', () => {
  it('names the stored meet of a target whose entries could not be read', async () => {
    jest.mocked(fetchJson).mockImplementation(async (url: string) => (url.includes('?') ? { total: 2, data: [entrant] } : { title: `${meetOf(url)} - Members` }));
    const results = await deployment().dryRun();
    expect(results[0]).toMatchObject({ label: 'Meet A', meet: 'Meet A', error: expect.any(String) });
  });
});

describe("the entries run's time budget (#574)", () => {
  it('stores every target when the run stays inside its budget', async () => {
    const { stored, failedSources } = deployment();
    expect(await failedSources()).toEqual([]);
    expect(stored).toEqual(['Meet A', 'Meet B', 'Meet C']);
  });

  it("records each target's whole Sport80 list after storing its entries", async () => {
    const { listed, failedSources } = deployment();
    expect(await failedSources()).toEqual([]);
    expect(listed).toEqual([
      ['Meet A', 1],
      ['Meet B', 1],
      ['Meet C', 1],
    ]);
  });

  it('stores the targets it reached and fails naming the ones it did not, the same ones every run', async () => {
    const slowFirstTarget = (meet: string) => {
      if (meet === 'Meet A') jest.advanceTimersByTime(RUN_BUDGET_MS);
    };
    const first = deployment(slowFirstTarget);
    expect(await first.failedSources()).toEqual(['Meet B', 'Meet C']);
    expect(first.stored).toEqual(['Meet A']);
    const second = deployment(slowFirstTarget);
    expect(await second.failedSources()).toEqual(['Meet B', 'Meet C']);
    expect(await deployment(slowFirstTarget).failureText()).toContain(`Meet B: ${NOT_REACHED}`);
    expect(await deployment(slowFirstTarget).unreached()).toEqual(['Meet B', 'Meet C']);
  });

  it('stores nothing for a target whose list arrives after the run gave up on it', async () => {
    let listArrives: (page: unknown) => void = () => {};
    jest.mocked(fetchJson).mockImplementation(async (url: string) => (url.includes('?') ? new Promise((resolve) => (listArrives = resolve)) : { title: `${meetOf(url)} - Members` }));
    const { stored, failureText } = deployment();
    const failure = failureText();
    await jest.advanceTimersByTimeAsync(HARD_STOP_MS);
    expect(await failure).toContain(`Meet A: ${OUT_OF_TIME}`);
    listArrives({ total: 1, data: [entrant] });
    await jest.advanceTimersByTimeAsync(0);
    expect(stored).toEqual([]);
  });

  it('stops waiting for a target still reading at the hard stop, so the run ends and names it', async () => {
    jest.mocked(fetchJson).mockImplementation(() => new Promise(() => {}));
    const { stored, failureText } = deployment();
    const failure = failureText();
    await jest.advanceTimersByTimeAsync(HARD_STOP_MS);
    const text = await failure;
    expect(text).toContain(`Meet A: ${OUT_OF_TIME}`);
    expect(text).toContain(`Meet B: ${NOT_REACHED}`);
    expect(text).toContain(`Meet C: ${NOT_REACHED}`);
    expect(stored).toEqual([]);
  });
});
