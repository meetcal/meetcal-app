import { getFunctionName } from 'convex/server';
import { afterRun, describeFailure } from '../../convex/lib/cronAlerts';
import { pdfLines } from '../../convex/scrapers/lib/pdf';
import { discoverRankingPdfs, parseMeetInfo, parseRankingsTable, type IntlRanking } from '../../convex/scrapers/parse/intlRankings';
import { parseUsamwEvents, type UsamwEvent } from '../../convex/scrapers/parse/usamwEvents';
import { run as runIntlRankings } from '../../convex/scrapers/intlRankings';
import { run as runUsamwEvents } from '../../convex/scrapers/usamwEvents';
import { handlerOf } from '../fakeDb';

// The network, PDF reader and page parsers are stubbed: these tests are about
// what a run stores and how it fails, not what it reads.
jest.mock('../../convex/scrapers/lib/http', () => ({ fetchText: jest.fn(async () => ''), fetchBytes: jest.fn(async () => new Uint8Array()) }));
jest.mock('../../convex/scrapers/lib/pdf', () => ({ pdfLines: jest.fn() }));
jest.mock('../../convex/scrapers/parse/intlRankings', () => ({
  RANKINGS_PAGE_URL: 'https://standings.example/',
  discoverRankingPdfs: jest.fn(),
  parseMeetInfo: jest.fn(),
  parseRankingsTable: jest.fn(),
}));
jest.mock('../../convex/scrapers/parse/usamwEvents', () => ({ EVENTS_URL: 'https://events.example/', parseUsamwEvents: jest.fn() }));

type Ctx = { runMutation: jest.Mock };
/** The error a run threw, failing the test if it returned instead. */
async function thrownBy(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error('expected the run to throw');
}

describe('intl-rankings: a group that fails to store (#218)', () => {
  const pdfs = [
    { title: 'Worlds - Women', url: 'https://cdn.example/w.pdf' },
    { title: 'Worlds - Men', url: 'https://cdn.example/m.pdf' },
    { title: 'Pan Ams - Women', url: 'https://cdn.example/p.pdf' },
  ];

  beforeEach(() => {
    jest.mocked(discoverRankingPdfs).mockReturnValue(pdfs);
    // The stubbed parsers name each group from its PDF's card title.
    jest.mocked(pdfLines).mockImplementation(async () => [['']]);
    jest.mocked(parseMeetInfo).mockImplementation((_lines, title) => ({
      meet_name: title.split(' - ')[0],
      gender: title.split(' - ')[1],
      age_category: 'Senior',
    }));
    jest.mocked(parseRankingsTable).mockImplementation((_lines, info) => [
      { meet: info.meet_name, ranking: 1, name: 'Jane Doe', weight_class: '71', total: 200, percent_a: 95, gender: info.gender, age_category: 'Senior' } satisfies IntlRanking,
    ]);
  });

  const ctx = (): Ctx => ({
    runMutation: jest.fn(async (fn: unknown, args: { meet?: string; gender?: string }) => {
      const name = getFunctionName(fn as never);
      if (name === 'ingest:replaceIntlRankingsGroup') {
        if (args.meet === 'Worlds' && args.gender === 'Men') throw new Error('Duplicate intl ranking in payload: Worlds/Men/Senior/1/Jane Doe');
        return { inserted: 1, updated: 0, unchanged: 0, deleted: 0 };
      }
      if (name === 'ingest:deleteMissingIntlRankingGroups') return { deletedGroups: [] };
      throw new Error(`unexpected mutation ${name}`);
    }),
  });

  it('stores the other groups, skips the prune and fails naming the PDF', async () => {
    const c = ctx();
    const error = await thrownBy(handlerOf<{ dryRun?: boolean }>(runIntlRankings)(c, {}));
    const stored = c.runMutation.mock.calls.filter(([fn]) => getFunctionName(fn as never) === 'ingest:replaceIntlRankingsGroup').map(([, args]) => `${args.meet} - ${args.gender}`);
    // The group after the failing one is still stored.
    expect(stored).toEqual(['Worlds - Women', 'Worlds - Men', 'Pan Ams - Women']);
    expect(c.runMutation.mock.calls.some(([fn]) => getFunctionName(fn as never) === 'ingest:deleteMissingIntlRankingGroups')).toBe(false);
    const failure = describeFailure(error);
    expect(failure.failedSources).toEqual(['Worlds - Men']);
    expect(failure.error).toContain('1 PDF(s) not stored, stale groups not pruned');
    expect(failure.error).toContain('Worlds - Men: https://cdn.example/m.pdf: not stored: Duplicate intl ranking in payload');
  });

  it('prunes when every group is stored', async () => {
    const c: Ctx = {
      runMutation: jest.fn(async (fn: unknown) =>
        getFunctionName(fn as never) === 'ingest:deleteMissingIntlRankingGroups' ? { deletedGroups: [] } : { inserted: 1, updated: 0, unchanged: 0, deleted: 0 },
      ),
    };
    await handlerOf<{ dryRun?: boolean }>(runIntlRankings)(c, {});
    expect(c.runMutation.mock.calls.map(([fn]) => getFunctionName(fn as never))).toEqual([
      'ingest:replaceIntlRankingsGroup',
      'ingest:replaceIntlRankingsGroup',
      'ingest:replaceIntlRankingsGroup',
      'ingest:deleteMissingIntlRankingGroups',
    ]);
  });
});

describe('usamw-events: one alert source per problem (#254)', () => {
  const event = (name: string): UsamwEvent => ({
    name,
    startDate: '2027-04-10',
    endDate: '2027-04-12',
    venueName: 'Arena',
    venueCity: 'Reno',
    venueState: 'NV',
    timeZone: 'America/Los_Angeles',
  });
  type Synced = { ambiguous: { event: string; meets: string[] }[]; renamed: { event: string; storedAs: string }[] };
  const runWith = async (synced: Synced) => {
    jest.mocked(parseUsamwEvents).mockReturnValue([event('Spring Classic'), event('2027 Masters Open')]);
    const runMutation = jest.fn(async () => ({ inserted: [], updated: [], unchanged: [], ...synced }));
    return thrownBy(handlerOf<{ dryRun?: boolean }>(runUsamwEvents)({ runMutation }, {}));
  };
  const ambiguous = { event: 'Spring Classic', meets: ['A', 'B'] };
  const renamed = { event: '2027 Masters Open', storedAs: '2027 Masters Open (USAMW)' };

  it('names each ambiguous event and each renamed meet by the event name, in a readable message', async () => {
    const failure = describeFailure(await runWith({ ambiguous: [ambiguous], renamed: [renamed] }));
    expect(failure.failedSources).toEqual(['event Spring Classic', 'meet 2027 Masters Open']);
    expect(failure.error).toBe(
      'usamw events: event Spring Classic: matches more than one meet (A / B), not updated; ' +
        'meet 2027 Masters Open: another meet is named "2027 Masters Open", so this one was stored as "2027 Masters Open (USAMW)"; ' +
        'results and entries sent under the plain name still attach to the other meet (rename one by hand)',
    );
  });

  it('emails a rename that arrives while the job is already failing on an ambiguous event', async () => {
    // Day 1: the ambiguous event fails the job, which emails.
    const day1 = afterRun('usamw-events', undefined, { ok: false, ...describeFailure(await runWith({ ambiguous: [ambiguous], renamed: [] })) });
    expect(day1).toMatchObject({ alerting: 'failed', failedSources: ['event Spring Classic'], notice: { kind: 'failed' } });
    // Day 2: still ambiguous, and a new meet stored under another name: a new incident, emailed.
    const day2 = afterRun('usamw-events', day1.alerting, { ok: false, ...describeFailure(await runWith({ ambiguous: [ambiguous], renamed: [renamed] })) }, day1.failedSources);
    expect(day2.notice?.detail).toContain('now also failing: meet 2027 Masters Open');
    expect(day2.notice?.detail).toContain('stored as "2027 Masters Open (USAMW)"');
    // Day 3: the meet now matches by its source name, so the rename is not
    // reported again; the ambiguous event alone stays quiet.
    const day3 = afterRun('usamw-events', day2.alerting, { ok: false, ...describeFailure(await runWith({ ambiguous: [ambiguous], renamed: [] })) }, day2.failedSources);
    expect(day3).toEqual({ alerting: 'failed', failedSources: ['event Spring Classic'] });
  });

  it('returns what it synced when nothing needs a person', async () => {
    jest.mocked(parseUsamwEvents).mockReturnValue([event('Spring Classic')]);
    const runMutation = jest.fn(async () => ({ inserted: ['Spring Classic'], updated: [], unchanged: [], ambiguous: [], renamed: [] }));
    await expect(handlerOf<{ dryRun?: boolean }>(runUsamwEvents)({ runMutation }, {})).resolves.toMatchObject({ inserted: ['Spring Classic'] });
  });
});
