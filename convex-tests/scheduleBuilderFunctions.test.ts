import { ConvexError } from 'convex/values';
import { getFunctionName } from 'convex/server';
import {
  claimLoad,
  claimSearch,
  defaults,
  deleteDraft,
  draft,
  drafts,
  finishLoad,
  LOAD_COOLDOWN_MS,
  MAX_DRAFTS_PER_USER,
  MAX_LOADS_PER_HOUR,
  MAX_SEARCHES_PER_HOUR,
  preview,
  saveDraft,
} from '../convex/scheduleBuilder';
import {
  listedMeetProblem,
  load,
  LOAD_BUDGET_MS,
  MAX_SEARCH_LENGTH,
  MAX_SEARCH_PAGES,
  MAX_SEARCH_RESULTS,
  MIN_SEARCH_LENGTH,
  search,
  SEARCH_BUDGET_MS,
  sport80LinkOf,
} from '../convex/scheduleBuilderLoad';
import { upsertEntryAthletes, upsertMeets } from '../convex/ingest';
import { addFromBuilder, BUILDER_TARGETS_MAX } from '../convex/scrapers/entryTargets';
import { entriesMeet } from '../convex/scrapers/queries';
import { fetchEntriesMeet, readEntries } from '../convex/scrapers/entries';
import { fetchWidgetPage } from '../convex/scrapers/meets';
import { defaultBuilderOptions } from '../convex/lib/scheduleBuilderOptions';
import { fakeMutationCtx, handlerOf } from './fakeDb';

jest.mock('../convex/scrapers/entries', () => ({ ...jest.requireActual('../convex/scrapers/entries'), fetchEntriesMeet: jest.fn(), readEntries: jest.fn() }));
jest.mock('../convex/scrapers/meets', () => ({ ...jest.requireActual('../convex/scrapers/meets'), fetchWidgetPage: jest.fn() }));
const fetchEntriesMeetMock = fetchEntriesMeet as jest.MockedFunction<typeof fetchEntriesMeet>;
const readEntriesMock = readEntries as jest.MockedFunction<typeof readEntries>;
const fetchWidgetPageMock = fetchWidgetPage as jest.MockedFunction<typeof fetchWidgetPage>;

const NOW = Date.UTC(2027, 0, 10, 12);
const MEET = '2027 Turkey Cup';
type Args = Record<string, unknown>;

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
afterEach(() => jest.restoreAllMocks());

const meetRow = {
  name: MEET,
  venueName: 'Gym',
  venueStreet: '1 Main St',
  venueCity: 'Austin',
  venueState: 'TX',
  venueZip: '78701',
  timeZone: 'America/Chicago',
  startDate: '2027-03-06',
  endDate: '2027-03-07',
  status: 'upcoming',
  federation: 'USAW',
  sourceId: '15084',
  updatedAt: 1,
};

const athlete = (name: string, gender: string, weightClass: string, entryTotal: number) => ({
  memberId: String(name.length * 1000 + entryTotal),
  name,
  age: 30,
  club: 'Club',
  gender,
  weightClass,
  entryTotal,
  meet: MEET,
  adaptive: false,
});

function server(seed: Record<string, Record<string, unknown>[]> = {}) {
  const store = fakeMutationCtx({ meets: [meetRow], ...seed });
  const as = (subject: string | null) => {
    const ctx = { ...store.ctx, auth: { getUserIdentity: async () => (subject === null ? null : { subject }) } };
    return (fn: unknown, args: Args = {}) => handlerOf<Args>(fn)(ctx, args) as Promise<unknown>;
  };
  return { ...store, as };
}

async function failure(promise: Promise<unknown>): Promise<{ status: number; error: string } | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof ConvexError) return error.data as { status: number; error: string };
    throw error;
  }
}

const options = () => defaultBuilderOptions(meetRow);

describe('defaults and preview', () => {
  it("answers the meet's dates and default options to anyone", async () => {
    const { as } = server();
    expect(await as(null)(defaults, { meet: MEET })).toEqual({
      meet: MEET,
      startDate: '2027-03-06',
      endDate: '2027-03-07',
      timeZone: 'America/Chicago',
      status: 'upcoming',
      options: options(),
    });
  });

  it('builds the stored roster signed out, and 404s an unknown meet', async () => {
    const { as } = server({ athletes: [athlete('Ann', 'Women', '58', 80), athlete('Bob', 'Male', '89', 150)] });
    const built = (await as(null)(preview, { meet: MEET, options: options(), edits: [] })) as { athletes: number; sessions: { groups: { gender: string }[] }[] };
    expect(built.athletes).toBe(2);
    expect(built.sessions.map((s) => s.groups.map((g) => g.gender))).toEqual([['Female'], ['Male']]);
    const labelled = (await as(null)(preview, { meet: MEET, options: options(), edits: [] })) as { sessions: { groups: { label: string }[] }[] };
    expect(labelled.sessions.map((s) => s.groups.map((g) => g.label))).toEqual([['W 58'], ['M 89']]);
    expect(await failure(as(null)(preview, { meet: 'Nope', options: options(), edits: [] }))).toEqual({ status: 404, error: 'meet not found' });
  });

  it('refuses options outside the limits before reading anything', async () => {
    const { as } = server();
    expect(await failure(as(null)(preview, { meet: 'Nope', options: { ...options(), platforms: [] }, edits: [] }))).toEqual({
      status: 400,
      error: 'platforms must name 1 to 6 platforms',
      max: 6,
    });
  });
});

describe('drafts', () => {
  it('saves, lists, reads and deletes only the signed-in user’s drafts', async () => {
    const { as } = server();
    const edits = [{ kind: 'swapSessions', session: 1, withSession: 2 }];
    expect(await as('user_a')(saveDraft, { meet: MEET, options: options(), edits })).toEqual({ meet: MEET, updatedAt: NOW });
    expect(await as('user_a')(drafts)).toEqual([{ meet: MEET, updatedAt: NOW }]);
    expect(await as('user_b')(drafts)).toEqual([]);
    expect(await as('user_a')(draft, { meet: MEET })).toEqual({ meet: MEET, options: options(), edits, updatedAt: NOW });
    expect(await as('user_b')(draft, { meet: MEET })).toBeNull();
    expect(await as('user_b')(deleteDraft, { meet: MEET })).toEqual({ deleted: false });
    expect(await as('user_a')(deleteDraft, { meet: MEET })).toEqual({ deleted: true });
    expect(await as('user_a')(draft, { meet: MEET })).toBeNull();
  });

  it('updates one draft per meet in place', async () => {
    const { as, rows } = server();
    await as('user_a')(saveDraft, { meet: MEET, options: options(), edits: [] });
    await as('user_a')(saveDraft, { meet: MEET, options: { ...options(), platforms: ['Red', 'Blue'] }, edits: [] });
    expect(rows('schedule_drafts').map((r) => (r.options as { platforms: string[] }).platforms)).toEqual([['Red', 'Blue']]);
  });

  it('needs sign-in and caps how many a user keeps', async () => {
    const held = Array.from({ length: MAX_DRAFTS_PER_USER }, (_, i) => ({ userId: 'user_a', meet: `Meet ${i}`, options: options(), edits: [], updatedAt: i }));
    const { as } = server({ schedule_drafts: held });
    expect(await failure(as(null)(saveDraft, { meet: MEET, options: options(), edits: [] }))).toEqual({ status: 401, error: 'unauthorized' });
    expect(await failure(as(null)(drafts))).toEqual({ status: 401, error: 'unauthorized' });
    expect(await failure(as('user_a')(saveDraft, { meet: MEET, options: options(), edits: [] }))).toEqual({
      status: 429,
      error: `at most ${MAX_DRAFTS_PER_USER} saved schedules; delete one first`,
      max: MAX_DRAFTS_PER_USER,
    });
  });
});

describe('load bookkeeping', () => {
  const claimOf = (answer: unknown) => (answer as { claim: string }).claim;

  it('reuses a load of the same event finished within the cooldown, but not a failed one', async () => {
    const { as } = server();
    expect(await as(null)(claimLoad, { eventId: '15084' })).toEqual({ claim: expect.any(String) });
    const claim = claimOf(await as(null)(claimLoad, { eventId: '15084' }));
    await as(null)(finishLoad, { claim, meet: MEET });
    expect(await as(null)(claimLoad, { eventId: '15084' })).toEqual({ recentMeet: MEET });
  });

  it('loads again after the cooldown', async () => {
    const { as } = server({ schedule_builder_loads: [{ eventId: '15084', meet: MEET, loadedAt: NOW - LOAD_COOLDOWN_MS - 1 }] });
    expect(await as(null)(claimLoad, { eventId: '15084' })).toEqual({ claim: expect.any(String) });
  });

  it('counts a finished load once against the hourly cap', async () => {
    const { as, rows } = server();
    for (let i = 0; i < MAX_LOADS_PER_HOUR; i++) await as(null)(finishLoad, { claim: claimOf(await as(null)(claimLoad, { eventId: `e${i}` })), meet: `Meet ${i}` });
    expect(rows('schedule_builder_loads')).toHaveLength(MAX_LOADS_PER_HOUR);
    expect(await failure(as(null)(claimLoad, { eventId: 'one more' }))).toMatchObject({ status: 429 });
  });

  it('caps loads an hour across everyone, and prunes day-old rows', async () => {
    const recent = Array.from({ length: MAX_LOADS_PER_HOUR }, (_, i) => ({ eventId: `e${i}`, meet: '', loadedAt: NOW - i }));
    const old = { eventId: 'old', meet: 'Old', loadedAt: NOW - 2 * 24 * 60 * 60 * 1000 };
    const { as, rows } = server({ schedule_builder_loads: [old, ...recent] });
    expect(await failure(as(null)(claimLoad, { eventId: '15084' }))).toEqual({
      status: 429,
      error: 'MeetCal is loading many meets right now; try again in a few minutes',
      max: MAX_LOADS_PER_HOUR,
    });
    expect(rows('schedule_builder_loads').some((r) => r.eventId === 'old')).toBe(false);
  });
});

describe('reading the pasted URL', () => {
  it('takes a Sport80 entries page and gives its event and canonical URL', () => {
    expect(sport80LinkOf(' https://usaweightlifting.sport80.com/public/events/15084/entries/22001?tab=1 ')).toEqual({
      eventId: '15084',
      entriesUrl: 'https://usaweightlifting.sport80.com/public/events/15084/entries/22001',
    });
  });

  it.each([
    'https://usaweightlifting.sport80.com/public/events/15084',
    'https://usaweightlifting.sport80.com/public/events/15084/?bl=locator',
    'https://usaweightlifting.sport80.com/public/wizard/e/15084',
    ' https://usaweightlifting.sport80.com/public/wizard/e/15084?ref=email ',
  ])("takes the meet's page or registration link %s, whose entries list is found later", (url) => {
    expect(sport80LinkOf(url)).toEqual({ eventId: '15084', entriesUrl: null });
  });

  it.each([
    ['usaweightlifting.sport80.com/public/events/15084/entries/22001?tab=1', 'https://usaweightlifting.sport80.com/public/events/15084/entries/22001'],
    [' usaweightlifting.sport80.com/public/events/15084 ', null],
    ['usaweightlifting.sport80.com/public/wizard/e/15084?ref=email', null],
  ])('reads %s, typed without https://, as the same link', (url, entriesUrl) => {
    expect(sport80LinkOf(url)).toEqual({ eventId: '15084', entriesUrl });
  });

  it.each([
    ['not a url', "paste the meet's Sport80 link, like https://usaweightlifting.sport80.com/public/events/12345, or its entries list"],
    ['https://example.com/public/events/1/entries/2', 'the URL must be a usaweightlifting.sport80.com meet page or entries list'],
    ['https://example.com/public/events/15084', 'the URL must be a usaweightlifting.sport80.com meet page or entries list'],
    ['example.com/public/events/15084', 'the URL must be a usaweightlifting.sport80.com meet page or entries list'],
    ...['/public/events', '/public/events/abc', '/public/events/15084/results', '/public/wizard/e/', '/public/wizard/x/15084', '/public/rankings'].map((path) => [
      `https://usaweightlifting.sport80.com${path}`,
      'that page is not a Sport80 meet page or entries list; open the meet on Sport80 and copy its URL from the address bar',
    ]),
  ])('refuses %s', async (url, error) => {
    expect(await failure(Promise.resolve().then(() => sport80LinkOf(url)))).toEqual({ status: 400, error });
  });

  it("explains why a listed event can't be stored", () => {
    const row = { id: '15084', name: 'Turkey Cup', address: null, subtitle: '11/21/2026 - 11/21/2026', isEvent: true, entriesUrl: null };
    expect(listedMeetProblem([row], '15084')).toEqual({ row });
    expect(listedMeetProblem([row], '999')).toEqual({ problem: "Sport80 doesn't list this event as upcoming, so MeetCal can't add it" });
    expect(listedMeetProblem([{ ...row, subtitle: 'TBC' }], '15084')).toEqual({ problem: "MeetCal couldn't read this meet's dates on Sport80" });
    expect(listedMeetProblem([{ ...row, name: 'ADAPTIVE ATHLETES - Cup' }], '15084')).toEqual({ problem: "MeetCal doesn't build schedules for adaptive events yet" });
  });
});

describe('entry targets from the builder', () => {
  const add = (store: ReturnType<typeof server>, url: string) => store.as(null)(addFromBuilder, { label: 'Meet', url });

  it('adds a target once and leaves an existing one alone', async () => {
    const store = server({ entry_targets: [{ label: 'Kept', url: 'u1' }] });
    await add(store, 'u1');
    await add(store, 'u2');
    expect(store.rows('entry_targets').map((r) => [r.label, r.url])).toEqual([
      ['Kept', 'u1'],
      ['Meet', 'u2'],
    ]);
  });

  it('refuses a new target past its share of the entries job, leaving room for the synced meets', async () => {
    const store = server({ entry_targets: Array.from({ length: BUILDER_TARGETS_MAX }, (_, i) => ({ label: `T${i}`, url: `u${i}` })) });
    expect(await failure(add(store, 'new'))).toEqual({
      status: 429,
      error: 'MeetCal is following as many meets as it can right now; try again in a few days',
      max: BUILDER_TARGETS_MAX,
    });
    expect(await add(store, 'u0')).toBeUndefined();
  });
});

describe('load', () => {
  const URL = 'https://usaweightlifting.sport80.com/public/events/15084/entries/22001';
  const listedRow = { id: '15084', name: 'Turkey Cup', address: 'Gym, 1 Main St, Saint Joseph, Missouri, United States of America, 64501', subtitle: '03/06/2027 - 03/06/2027' };
  const listing = { total: 1, data: [listedRow] };
  const entry = { memberId: '123456', name: 'Ann Lifter', age: 30, club: 'Club', gender: 'Female', weightClass: '58', entryTotal: 80 };
  const functions: Record<string, unknown> = {
    'scheduleBuilder:claimLoad': claimLoad,
    'scheduleBuilder:finishLoad': finishLoad,
    'scheduleBuilder:claimSearch': claimSearch,
    'scrapers/queries:entriesMeet': entriesMeet,
    'ingest:upsertMeets': upsertMeets,
    'scrapers/entryTargets:addFromBuilder': addFromBuilder,
    'ingest:upsertEntryAthletes': upsertEntryAthletes,
  };

  function actionServer(seed: Record<string, Record<string, unknown>[]> = {}) {
    const store = fakeMutationCtx(seed);
    const run = (fn: unknown, args: Args) => {
      const registered = functions[getFunctionName(fn as never)];
      if (!registered) throw new Error(`no test handler for ${getFunctionName(fn as never)}`);
      return handlerOf<Args>(registered)(store.ctx, args);
    };
    const ctx = { ...store.ctx, runQuery: run, runMutation: run };
    return { ...store, load: (url: string) => handlerOf<Args>(load)(ctx, { url }), search: (query: string) => handlerOf<Args>(search)(ctx, { query }) };
  }

  const SLOW = { status: 504, error: 'Sport80 is slow right now; try again in a minute' };

  async function afterTheBudget(work: Promise<unknown>, budgetMs: number) {
    const answer = failure(work);
    await jest.advanceTimersByTimeAsync(budgetMs);
    return answer;
  }

  function withMovingClock() {
    (Date.now as jest.Mock).mockRestore();
    jest.useFakeTimers({ now: NOW });
  }

  beforeEach(() => {
    fetchEntriesMeetMock.mockReset().mockResolvedValue('Turkey Cup');
    readEntriesMock.mockReset().mockImplementation(async (_ctx, _url, meet) => [{ ...entry, meet }]);
    fetchWidgetPageMock.mockReset().mockResolvedValue(listing);
  });

  it('stores a new meet with its event id, follows its entries and stores them, then reuses them within the cooldown', async () => {
    const store = actionServer();
    expect(await store.load(URL)).toEqual({ meet: 'Turkey Cup', refreshed: true });
    expect(store.rows('meets').map((m) => [m.name, m.sourceId, m.startDate, m.timeZone])).toEqual([['Turkey Cup', '15084', '2027-03-06', 'America/Chicago']]);
    expect(store.rows('entry_targets').map((t) => t.url)).toEqual([URL]);
    expect(store.rows('athletes').map((a) => a.name)).toEqual(['Ann Lifter']);
    expect(await store.load(`${URL}?bl=locator`)).toEqual({ meet: 'Turkey Cup', refreshed: false });
    expect(fetchEntriesMeetMock).toHaveBeenCalledTimes(1);
  });

  it('uses a meet already stored under the event id without reading the listing', async () => {
    const store = actionServer({ meets: [{ ...meetRow, name: 'Stored Cup' }] });
    expect(await store.load(URL)).toEqual({ meet: 'Stored Cup', refreshed: true });
    expect(fetchWidgetPageMock).not.toHaveBeenCalled();
  });

  it('refuses a completed meet', async () => {
    const store = actionServer({ meets: [{ ...meetRow, status: 'completed' }] });
    expect(await failure(store.load(URL))).toEqual({ status: 409, error: 'this meet is over, so its schedule can no longer be built' });
  });

  it("says why when Sport80's entries change too much to store on their own", async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const stored = Array.from({ length: 10 }, (_, i) => athlete(`Lifter ${i}`, 'Women', '58', 70 + i));
    const store = actionServer({ meets: [meetRow], athletes: stored });
    expect(await failure(store.load(URL))).toEqual({
      status: 409,
      error: "the meet's entries changed more than MeetCal updates on its own; they'll be checked by hand. Try again later",
    });
  });

  describe("from the meet's page", () => {
    const MEET_PAGE = 'https://usaweightlifting.sport80.com/public/events/15084';
    const WIZARD = 'https://usaweightlifting.sport80.com/public/wizard/e/15084?x=1';
    const UPCOMING = 'https://usaweightlifting.sport80.com/api/public/widget/data/new/1?p=0&i=20&l=&d=10&f=&s=';
    const entryList = { type: 'internal', url: `${URL}?bl=`, text: 'Entry List' };
    const enterNow = { type: 'internal', url: 'https://usaweightlifting.sport80.com/public/wizard/e/15084', text: 'Enter Now' };
    const listedWith = (actions: unknown[]) => ({ total: 1, data: [{ ...listedRow, is_event: true, actions }] });

    beforeEach(() => {
      fetchWidgetPageMock.mockResolvedValue(listedWith([enterNow, entryList]));
    });

    it.each([MEET_PAGE, WIZARD, 'usaweightlifting.sport80.com/public/events/15084'])(
      'takes the entries list of %s from its row in the upcoming listing, reading the listing once',
      async (link) => {
        const store = actionServer();
        expect(await store.load(link)).toEqual({ meet: 'Turkey Cup', refreshed: true });
        expect(fetchWidgetPageMock.mock.calls).toEqual([[UPCOMING]]);
        expect(fetchEntriesMeetMock).toHaveBeenCalledWith(URL);
        expect(store.rows('entry_targets').map((t) => t.url)).toEqual([URL]);
        expect(store.rows('schedule_builder_loads').map((row) => [row.eventId, row.meet])).toEqual([['15084', 'Turkey Cup']]);
      },
    );

    it('shares the cooldown with the entries link of the same event', async () => {
      const store = actionServer();
      await store.load(URL);
      expect(await store.load(MEET_PAGE)).toEqual({ meet: 'Turkey Cup', refreshed: false });
      expect(await store.load(WIZARD)).toEqual({ meet: 'Turkey Cup', refreshed: false });
      expect(fetchWidgetPageMock).toHaveBeenCalledTimes(1);
      expect(fetchEntriesMeetMock).toHaveBeenCalledTimes(1);
    });

    it('refuses an event Sport80 does not list as upcoming', async () => {
      const store = actionServer();
      expect(await failure(store.load('https://usaweightlifting.sport80.com/public/events/999'))).toEqual({
        status: 422,
        error: "Sport80 doesn't list this event as upcoming, so MeetCal can't add it",
      });
      expect(fetchEntriesMeetMock).not.toHaveBeenCalled();
    });

    it.each([
      ['no entries action', listedWith([enterNow])],
      ["only another event's entries list", listedWith([{ ...entryList, url: 'https://usaweightlifting.sport80.com/public/events/14189/entries/21081?bl=' }])],
      ['no actions', listing],
    ])('says Sport80 shows no entry list yet when the listed row has %s', async (_, answer) => {
      fetchWidgetPageMock.mockResolvedValue(answer);
      const store = actionServer();
      expect(await failure(store.load(MEET_PAGE))).toEqual({ status: 422, error: "Sport80 doesn't show a public entry list for this meet yet" });
      expect(fetchEntriesMeetMock).not.toHaveBeenCalled();
    });

    it('answers 502 when the listing fails or answers something else', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = actionServer();
      fetchWidgetPageMock.mockRejectedValueOnce(new Error('GET widget failed with 500'));
      expect(await failure(store.load(MEET_PAGE))).toEqual({ status: 502, error: 'Sport80 did not answer; try again in a minute' });
      fetchWidgetPageMock.mockResolvedValueOnce({ total: 1, data: 'nope' });
      expect(await failure(store.load(MEET_PAGE))).toEqual({ status: 502, error: 'Sport80 did not answer; try again in a minute' });
      expect(fetchEntriesMeetMock).not.toHaveBeenCalled();
    });
  });

  describe('within its time budget', () => {
    afterEach(() => jest.useRealTimers());

    it(`answers 504 once Sport80 has taken ${LOAD_BUDGET_MS / 1000} seconds, leaving the claim open for the next try`, async () => {
      withMovingClock();
      fetchEntriesMeetMock.mockReturnValueOnce(new Promise(() => {}));
      const store = actionServer();
      expect(await afterTheBudget(store.load(URL), LOAD_BUDGET_MS)).toEqual(SLOW);
      expect(store.rows('schedule_builder_loads').map((row) => row.meet)).toEqual(['']);
      jest.useRealTimers();
      expect(await store.load(URL)).toEqual({ meet: 'Turkey Cup', refreshed: true });
    });

    it('stops before the next Sport80 read once an earlier one used up the budget', async () => {
      fetchEntriesMeetMock.mockImplementationOnce(async () => {
        (Date.now as jest.Mock).mockReturnValue(NOW + LOAD_BUDGET_MS);
        return 'Turkey Cup';
      });
      const store = actionServer();
      expect(await failure(store.load(URL))).toEqual(SLOW);
      expect(readEntriesMock).not.toHaveBeenCalled();
    });

    it(`answers 504 when a search takes ${SEARCH_BUDGET_MS / 1000} seconds`, async () => {
      withMovingClock();
      fetchWidgetPageMock.mockReset().mockReturnValueOnce(new Promise(() => {}));
      expect(await afterTheBudget(actionServer().search('Turkey Cup'), SEARCH_BUDGET_MS)).toEqual(SLOW);
    });
  });

  it('answers 502 when Sport80 does not answer, and lets the next try load', async () => {
    fetchEntriesMeetMock.mockRejectedValueOnce(new Error('timeout'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = actionServer();
    expect(await failure(store.load(URL))).toEqual({ status: 502, error: 'Sport80 did not answer; try again in a minute' });
    expect(await store.load(URL)).toEqual({ meet: 'Turkey Cup', refreshed: true });
  });
});

describe('search', () => {
  const LISTING = 'https://usaweightlifting.sport80.com/api/public/widget/data/new/1';
  const event = (id: number, extra: Record<string, unknown> = {}) => ({
    id: String(id),
    is_event: true,
    name: `Cup ${id}`,
    subtitle: '11/21/2026 - 11/22/2026',
    address: `Gym, 1 Main St, Town ${id}, Missouri, United States of America, 64504`,
    actions: [
      { url: `https://usaweightlifting.sport80.com/public/wizard/e/${id}`, text: 'Enter Now' },
      { url: `https://usaweightlifting.sport80.com/public/events/${id}/entries/${id + 1}?bl=`, text: 'Entry List' },
    ],
    ...extra,
  });
  const pages = (total: number, rows: unknown[][]) =>
    fetchWidgetPageMock.mockReset().mockImplementation(async (url) => ({ total, data: rows[Number(new URL(url).searchParams.get('p'))] ?? [] }));

  function searchServer(seed: Record<string, Record<string, unknown>[]> = {}) {
    const store = fakeMutationCtx(seed);
    const ctx = { ...store.ctx, runMutation: (_fn: unknown, args: Args) => handlerOf<Args>(claimSearch)(store.ctx, args) };
    return { ...store, search: (query: string) => handlerOf<Args>(search)(ctx, { query }) };
  }

  it("lists Sport80's upcoming events by name, with their dates, place and entries list when they have one, skipping rows without an event id", async () => {
    pages(4, [
      [
        event(15084),
        event(15090, { actions: [{ url: 'https://usaweightlifting.sport80.com/public/wizard/e/15090', text: 'Enter Now' }], subtitle: 'TBD', address: null }),
        event(15091, { is_event: false }),
        event(15092, { subtitle: '12/05/2026', address: 'Arena, 2 Rue, Paris, France, 75001' }),
        event(15094, { id: null }),
      ],
    ]);
    expect(await searchServer().search('  Turkey Cup ')).toEqual({
      results: [
        {
          eventId: '15084',
          name: 'Cup 15084',
          startDate: '2026-11-21',
          endDate: '2026-11-22',
          place: 'Town 15084, Missouri',
          entriesUrl: 'https://usaweightlifting.sport80.com/public/events/15084/entries/15085',
        },
        { eventId: '15090', name: 'Cup 15090', startDate: '', endDate: '', place: '', entriesUrl: null },
        {
          eventId: '15092',
          name: 'Cup 15092',
          startDate: '2026-12-05',
          endDate: '2026-12-05',
          place: 'Paris, France',
          entriesUrl: 'https://usaweightlifting.sport80.com/public/events/15092/entries/15093',
        },
      ],
      truncated: false,
    });
    expect(fetchWidgetPageMock.mock.calls).toEqual([[`${LISTING}?p=0&i=20&l=&d=10&f=&s=Turkey%20Cup`]]);
  });

  it(`answers at most ${MAX_SEARCH_RESULTS} events from ${MAX_SEARCH_PAGES} pages, and says when there were more`, async () => {
    const page = (from: number) => Array.from({ length: 20 }, (_, i) => event(from + i));
    pages(100, [page(1000), page(2000), page(3000)]);
    const answer = (await searchServer().search('Open')) as { results: { eventId: string }[]; truncated: boolean };
    expect(answer.results.map((r) => r.eventId)).toEqual(page(1000).map((r) => r.id));
    expect(answer.truncated).toBe(true);
    expect(fetchWidgetPageMock).toHaveBeenCalledTimes(MAX_SEARCH_PAGES);
  });

  it('fills from the next page what non-events left out, and is not truncated once every match is read', async () => {
    const first = Array.from({ length: 20 }, (_, i) => event(1000 + i, i < 5 ? { is_event: false } : {}));
    pages(25, [first, Array.from({ length: 5 }, (_, i) => event(2000 + i))]);
    const answer = (await searchServer().search('Open')) as { results: unknown[]; truncated: boolean };
    expect(answer).toMatchObject({ truncated: false });
    expect(answer.results).toHaveLength(20);
  });

  it.each([
    ['ab', `type at least ${MIN_SEARCH_LENGTH} characters of the meet's name`],
    ['   ', `type at least ${MIN_SEARCH_LENGTH} characters of the meet's name`],
    ['x'.repeat(MAX_SEARCH_LENGTH + 1), `a meet name is at most ${MAX_SEARCH_LENGTH} characters`],
  ])('refuses %j before asking Sport80 or counting it', async (query, error) => {
    pages(0, []);
    const store = searchServer();
    expect(await failure(store.search(query))).toMatchObject({ status: 400, error });
    expect(fetchWidgetPageMock).not.toHaveBeenCalled();
    expect(store.rows('schedule_builder_searches')).toEqual([]);
  });

  it(`takes ${MAX_SEARCH_LENGTH} characters`, async () => {
    pages(0, [[]]);
    expect(await searchServer().search('x'.repeat(MAX_SEARCH_LENGTH))).toEqual({ results: [], truncated: false });
  });

  it(`caps searches at ${MAX_SEARCHES_PER_HOUR} an hour across everyone, and prunes day-old rows`, async () => {
    pages(0, [[]]);
    const recent = Array.from({ length: MAX_SEARCHES_PER_HOUR - 1 }, (_, i) => ({ searchedAt: NOW - i }));
    const store = searchServer({ schedule_builder_searches: [{ searchedAt: NOW - 2 * 24 * 60 * 60 * 1000 }, ...recent] });
    expect(await store.search('Turkey')).toEqual({ results: [], truncated: false });
    expect(await failure(store.search('Turkey'))).toEqual({
      status: 429,
      error: 'MeetCal is searching Sport80 a lot right now; try again in a few minutes',
      max: MAX_SEARCHES_PER_HOUR,
    });
    expect(store.rows('schedule_builder_searches')).toHaveLength(MAX_SEARCHES_PER_HOUR);
    expect(fetchWidgetPageMock).toHaveBeenCalledTimes(1);
  });

  it('answers 502 when Sport80 fails or answers something else', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchWidgetPageMock.mockReset().mockRejectedValueOnce(new Error('GET widget failed with 500')).mockResolvedValueOnce({ total: 1, data: 'nope' });
    const store = searchServer();
    expect(await failure(store.search('Turkey'))).toEqual({ status: 502, error: 'Sport80 did not answer; try again in a minute' });
    expect(await failure(store.search('Turkey'))).toEqual({ status: 502, error: 'Sport80 did not answer; try again in a minute' });
  });
});
