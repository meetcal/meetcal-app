import { ConvexError } from 'convex/values';
import { claimLoad, defaults, deleteDraft, draft, drafts, finishLoad, LOAD_COOLDOWN_MS, MAX_DRAFTS_PER_USER, MAX_LOADS_PER_HOUR, preview, saveDraft } from '../convex/scheduleBuilder';
import { entriesPageOf, listedMeetProblem } from '../convex/scheduleBuilderLoad';
import { defaultBuilderOptions } from '../convex/lib/scheduleBuilderOptions';
import { fakeMutationCtx, handlerOf } from './fakeDb';

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
  it('reuses a load of the same event finished within the cooldown, but not a failed one', async () => {
    const { as } = server();
    expect(await as(null)(claimLoad, { eventId: '15084' })).toEqual({ recentMeet: null });
    expect(await as(null)(claimLoad, { eventId: '15084' })).toEqual({ recentMeet: null });
    await as(null)(finishLoad, { eventId: '15084', meet: MEET });
    expect(await as(null)(claimLoad, { eventId: '15084' })).toEqual({ recentMeet: MEET });
  });

  it('loads again after the cooldown', async () => {
    const { as } = server({ schedule_builder_loads: [{ eventId: '15084', meet: MEET, loadedAt: NOW - LOAD_COOLDOWN_MS - 1 }] });
    expect(await as(null)(claimLoad, { eventId: '15084' })).toEqual({ recentMeet: null });
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
    expect(entriesPageOf(' https://usaweightlifting.sport80.com/public/events/15084/entries/22001?tab=1 ')).toEqual({
      eventId: '15084',
      url: 'https://usaweightlifting.sport80.com/public/events/15084/entries/22001',
    });
  });

  it.each([
    ['not a url', 'paste the Sport80 entries page URL, like https://usaweightlifting.sport80.com/public/events/12345/entries/67890'],
    ['https://example.com/public/events/1/entries/2', 'the URL must be a usaweightlifting.sport80.com entries page'],
    ['https://usaweightlifting.sport80.com/public/events/15084', "that page is not a Sport80 entries list; open the meet's Entries tab on Sport80 and copy its URL"],
  ])('refuses %s', async (url, error) => {
    expect(await failure(Promise.resolve().then(() => entriesPageOf(url)))).toEqual({ status: 400, error });
  });

  it("explains why a listed event can't be stored", () => {
    const row = { id: '15084', name: 'Turkey Cup', address: null, subtitle: '11/21/2026 - 11/21/2026' };
    expect(listedMeetProblem([row], '15084')).toEqual({ row });
    expect(listedMeetProblem([row], '999')).toEqual({ problem: "Sport80 doesn't list this event as upcoming, so MeetCal can't add it" });
    expect(listedMeetProblem([{ ...row, subtitle: 'TBC' }], '15084')).toEqual({ problem: "MeetCal couldn't read this meet's dates on Sport80" });
    expect(listedMeetProblem([{ ...row, name: 'ADAPTIVE ATHLETES - Cup' }], '15084')).toEqual({ problem: "MeetCal doesn't build schedules for adaptive events yet" });
  });
});
