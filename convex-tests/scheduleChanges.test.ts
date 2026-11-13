import { ConvexError } from 'convex/values';
import { changes, defaults, NOT_PUBLISHED, preview } from '../convex/scheduleBuilder';
import { approve, publish, STALE_APPROVAL, STALE_BASE } from '../convex/schedulePublications';
import { forgetSport80Entrants, recordSport80Entrants } from '../convex/ingest';
import { buildSchedule } from '../convex/lib/scheduleBuilder';
import { suggestedPlace } from '../convex/lib/scheduleChanges';
import { defaultBuilderOptions, type BuilderOptions } from '../convex/lib/scheduleBuilderOptions';
import { fakeMutationCtx, handlerOf } from './fakeDb';

const NOW = Date.UTC(2027, 0, 10, 12);
const MEET = 'Turkey Cup';
type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const meetRow = {
  name: MEET,
  venueName: 'Gym',
  venueStreet: '1 Main St',
  venueCity: 'Saint Joseph',
  venueState: 'MO',
  venueZip: '64501',
  timeZone: 'America/Chicago',
  startDate: '2027-03-06',
  endDate: '2027-03-06',
  status: 'upcoming',
  federation: 'USAW',
  sourceId: '15084',
  updatedAt: 1,
};

type Lifter = { memberId: string; name: string; gender: string; weightClass: string; entryTotal: number; age?: number };

const entrant = ({ age = 30, ...lifter }: Lifter) => ({ ...lifter, age, club: 'Club' });
const rostered = (lifter: Lifter, sessionNumber: number, extra: Row = {}) => ({ ...entrant(lifter), meet: MEET, adaptive: false, sessionNumber, sessionPlatform: 'Red', ...extra });
const listed = (lifter: Lifter) => ({ ...entrant(lifter), meet: MEET });

const ann: Lifter = { memberId: '101', name: 'Ann Lee', gender: 'Women', weightClass: '58', entryTotal: 80 };
const bea: Lifter = { memberId: '102', name: 'Bea Cho', gender: 'Women', weightClass: '58', entryTotal: 90 };
const cal: Lifter = { memberId: '103', name: 'Cal Diaz', gender: 'Men', weightClass: '89', entryTotal: 150 };
const dan: Lifter = { memberId: '104', name: 'Dan Fox', gender: 'Men', weightClass: '96', entryTotal: 160 };
const eve: Lifter = { memberId: '105', name: 'Eve Gray', gender: 'Men', weightClass: '89', entryTotal: 120 };
const gia: Lifter = { memberId: '106', name: 'Gia Hu', gender: 'Women', weightClass: '63', entryTotal: 100 };
const ida: Lifter = { memberId: '107', name: 'Ida Ito', gender: 'Women', weightClass: '63', entryTotal: 120 };
const jo: Lifter = { memberId: '108', name: 'Jo Kim', gender: 'Women', weightClass: '63', entryTotal: 125 };
const fay: Lifter = { memberId: '109', name: 'Fay Lund', gender: 'Women', weightClass: '58', entryTotal: 70, age: 25 };
const gus: Lifter = { memberId: '110', name: 'Gus Mora', gender: 'Men', weightClass: '102', entryTotal: 170 };

const roster = () => [rostered(ann, 1), rostered(bea, 1), rostered(cal, 2), rostered(dan, 2), rostered(eve, 2, { adaptive: true }), rostered(gia, 3), rostered(ida, 4), rostered(jo, 4)];

const scheduleRow = (sessionId: number, startTime: string, weightClass: string) => ({
  meet: MEET,
  date: '2027-03-06',
  sessionId,
  startTime,
  weighInTime: '07:00:00',
  platform: 'Red',
  weightClass,
});

const publishedRows = () => [scheduleRow(1, '09:00:00', 'W 58'), scheduleRow(2, '11:00:00', 'M 89, 96'), scheduleRow(3, '13:00:00', 'W 63 B'), scheduleRow(4, '15:00:00', 'W 63 A')];

const sport80Today = () => [listed(ann), listed(bea), listed(cal), listed(gia), listed(ida), listed(jo), listed(fay), listed(gus)];

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
afterEach(() => jest.restoreAllMocks());

function server(seed: Record<string, Row[]> = {}) {
  const store = fakeMutationCtx({ meets: [meetRow], athletes: roster(), session_schedule: publishedRows(), ...seed });
  const as = (subject: string | null) => {
    const ctx = { ...store.ctx, auth: { getUserIdentity: async () => (subject === null ? null : { subject }) } };
    return (fn: unknown, args: Args = {}) => handlerOf<Args>(fn)(ctx, args) as Promise<unknown>;
  };
  const record = (rows: Row[]) => as(null)(recordSport80Entrants, { meet: MEET, rows });
  return { ...store, as, record };
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

type Board = {
  athletes: number;
  sessions: { id: number; number: number; groups: { platform: string; label: string; athletes: { name: string; withdrawn?: boolean }[] }[] }[];
  warnings: { code: string }[];
  changes: {
    checkedAt: number | null;
    added: { athlete: { key: string; name: string }; suggestion: { session: number; number: number; platform: string } | null }[];
    withdrawn: { athlete: { key: string; name: string }; place: { session: number; number: number; platform: string }; occurrence: number }[];
  };
};

async function publishedOptions(store: ReturnType<typeof server>): Promise<BuilderOptions> {
  const answer = (await store.as(null)(defaults, { meet: MEET })) as { published: { options: BuilderOptions } | null };
  if (!answer.published) throw new Error('the meet should be published');
  return answer.published.options;
}

async function board(store: ReturnType<typeof server>, edits: Args[] = []): Promise<Board> {
  return (await store.as(null)(preview, { meet: MEET, options: await publishedOptions(store), edits, base: 'published' })) as Board;
}

const labels = (answer: Board) => answer.sessions.map((s) => [s.number, s.groups.map((g) => [g.label, g.athletes.map((a) => a.name)])]);
const keyOf = (lifter: Lifter) => `${lifter.memberId}|${lifter.name.toLowerCase()}`;

describe("recording Sport80's list", () => {
  it('keeps nothing for a meet whose start list is not published, and clears what it kept', async () => {
    const store = server({ athletes: roster().map(({ sessionNumber: _n, sessionPlatform: _p, ...row }) => row), sport80_entrants: [listed(ann)], sport80_entrant_checks: [{ meet: MEET, checkedAt: 1, count: 1 }] });
    expect(await store.record(sport80Today())).toEqual({ published: false, inserted: 0, updated: 0, deleted: 1 });
    expect(store.rows('sport80_entrants')).toEqual([]);
    expect(store.rows('sport80_entrant_checks')).toEqual([]);
  });

  it('stores the entrants the roster sync would store, once each, and marks when it checked', async () => {
    const store = server();
    const junk = { ...listed(ann), name: 'undefined undefined', memberId: '999' };
    const badId = { ...listed(bea), memberId: 'abc' };
    const renamedListing = { ...listed(cal), club: 'New Club' };
    expect(await store.record([listed(cal), renamedListing, junk, badId, listed(ann)])).toEqual({ published: true, inserted: 2, updated: 0, deleted: 0 });
    expect(store.rows('sport80_entrants').map((r) => [r.name, r.club, r.gender])).toEqual([
      ['Cal Diaz', 'New Club', 'Men'],
      ['Ann Lee', 'Club', 'Women'],
    ]);
    expect(store.rows('sport80_entrant_checks')).toEqual([{ meet: MEET, checkedAt: NOW, count: 2 }]);
  });

  it('changes only what changed on the next check', async () => {
    const store = server();
    await store.record([listed(ann), listed(cal)]);
    expect(await store.record([{ ...listed(ann), entryTotal: 85 }, listed(gia)])).toEqual({ published: true, inserted: 1, updated: 1, deleted: 1 });
    expect(store.rows('sport80_entrants').map((r) => [r.name, r.entryTotal])).toEqual([
      ['Ann Lee', 85],
      ['Gia Hu', 100],
    ]);
    expect(store.rows('sport80_entrant_checks')).toHaveLength(1);
  });

  it('forgets a meet when its target is removed', async () => {
    const store = server();
    await store.record(sport80Today());
    expect(await store.as(null)(forgetSport80Entrants, { meet: MEET })).toEqual({ deleted: 8 });
    expect(store.rows('sport80_entrants')).toEqual([]);
    expect(store.rows('sport80_entrant_checks')).toEqual([]);
  });
});

describe('the changes on Sport80', () => {
  it('lists nothing before Sport80 was checked, rather than everyone as withdrawn', async () => {
    const store = server();
    expect(await store.as(null)(changes, { meet: MEET })).toEqual({ checkedAt: null, added: [], withdrawn: [] });
  });

  it('answers the new entrants with a session each and the withdrawn with where they lift, never an adaptive athlete', async () => {
    const store = server();
    await store.record(sport80Today());
    const answer = (await store.as(null)(changes, { meet: MEET })) as Board['changes'];
    expect(answer.checkedAt).toBe(NOW);
    expect(answer.added.map((a) => [a.athlete.name, a.suggestion])).toEqual([
      ['Fay Lund', { session: 1, number: 1, platform: 'Red' }],
      ['Gus Mora', { session: 2, number: 2, platform: 'Red' }],
    ]);
    expect(answer.withdrawn.map((w) => [w.athlete.name, w.place, w.occurrence])).toEqual([['Dan Fox', { session: 2, number: 2, platform: 'Red' }, 0]]);
  });

  it('suggests the group of the class with the fewest athletes, then the nearest class, then nothing', () => {
    const options = { ...defaultBuilderOptions(meetRow), maxAthletesPerPlatform: 2 };
    const built = buildSchedule([entrant(gia), entrant(ida), entrant(jo), entrant(ann)], options);
    const lifter = (l: Lifter) => ({ ...entrant(l), gender: l.gender === 'Women' ? 'Female' : 'Male', key: keyOf(l) });
    const at = (place: { number: number } | null) => place?.number ?? null;
    const of63 = built.sessions.filter((s) => s.groups.some((g) => g.weightClasses.includes('63')));
    const fewest = of63.reduce((a, b) => ((a.groups[0]?.athletes.length ?? 0) <= (b.groups[0]?.athletes.length ?? 0) ? a : b));
    expect(at(suggestedPlace(lifter({ ...gia, memberId: '200', name: 'New One' }), built.sessions, true))).toBe(fewest.number);
    const near = suggestedPlace(lifter({ ...ann, memberId: '201', name: 'New Two', weightClass: '53' }), built.sessions, true);
    expect(built.sessions.find((s) => s.number === at(near))?.groups[0]?.weightClasses).toContain('58');
    expect(suggestedPlace(lifter(gus), built.sessions, true)).toBeNull();
  });

  it("prefers a nearer class of the entrant's own age group over a nearer one of another", () => {
    const options = defaultBuilderOptions(meetRow);
    const master = { memberId: '300', name: 'Mae Old', gender: 'Women', weightClass: '58', entryTotal: 70, age: 40 };
    const open = { memberId: '301', name: 'Ora Mid', gender: 'Women', weightClass: '69', entryTotal: 90, age: 25 };
    const built = buildSchedule([entrant(master), entrant(open)], options);
    const newcomer = { ...entrant({ ...open, memberId: '302', name: 'Nia New', weightClass: '63' }), gender: 'Female', key: '302|nia new' };
    const place = suggestedPlace(newcomer, built.sessions, true);
    expect(built.sessions.find((s) => s.id === place?.session)?.groups[0]?.weightClasses).toEqual(['69']);
  });
});

describe('building on the published schedule', () => {
  it('opens on the published sessions with their numbers and labels, split letters included', async () => {
    const store = server();
    const answer = await board(store);
    expect(labels(answer)).toEqual([
      [1, [['W 58', ['Ann Lee', 'Bea Cho']]]],
      [2, [['M 89, 96', ['Eve Gray', 'Cal Diaz', 'Dan Fox']]]],
      [3, [['W 63 B', ['Gia Hu']]]],
      [4, [['W 63 A', ['Ida Ito', 'Jo Kim']]]],
    ]);
    expect(answer.sessions.map((s) => s.id)).toEqual([1, 2, 3, 4]);
    expect(answer.changes).toEqual({ checkedAt: null, added: [], withdrawn: [] });
  });

  it('marks the withdrawn on the board, places a new entrant and removes a withdrawn one', async () => {
    const store = server();
    await store.record(sport80Today());
    const opened = await board(store);
    expect(opened.sessions[1]?.groups[0]?.athletes.find((a) => a.name === 'Dan Fox')?.withdrawn).toBe(true);
    const edited = await board(store, [
      { kind: 'addAthlete', athlete: keyOf(fay), toSession: 1, toPlatform: 'Red' },
      { kind: 'removeAthlete', athlete: keyOf(dan), fromSession: 2, fromPlatform: 'Red', occurrence: 0 },
    ]);
    expect(labels(edited).slice(0, 2)).toEqual([
      [1, [['W 58', ['Fay Lund', 'Ann Lee', 'Bea Cho']]]],
      [2, [['M 89', ['Eve Gray', 'Cal Diaz']]]],
    ]);
    expect(edited.athletes).toBe(8);
    expect(edited.changes.added.map((a) => a.athlete.name)).toEqual(['Gus Mora']);
    expect(edited.changes.withdrawn).toEqual([]);
    expect(edited.warnings.map((w) => w.code)).not.toContain('skippedEdit');
  });

  it('skips adding anyone who is not new on Sport80, and puts a removed new entrant back on the list', async () => {
    const store = server();
    await store.record(sport80Today());
    const edited = await board(store, [
      { kind: 'addAthlete', athlete: keyOf(ann), toSession: 2, toPlatform: 'Red' },
      { kind: 'addAthlete', athlete: keyOf(gus), toSession: 2, toPlatform: 'Red' },
      { kind: 'removeAthlete', athlete: keyOf(gus), fromSession: 2, fromPlatform: 'Red', occurrence: 0 },
    ]);
    expect(edited.warnings.map((w) => w.code)).toContain('skippedEdit');
    expect(edited.changes.added.map((a) => a.athlete.name)).toEqual(['Fay Lund', 'Gus Mora']);
  });

  it('skips the new edits when building from scratch', async () => {
    const store = server();
    await store.record(sport80Today());
    const options = await publishedOptions(store);
    const built = (await store.as(null)(preview, { meet: MEET, options, edits: [{ kind: 'addAthlete', athlete: keyOf(fay), toSession: 1, toPlatform: 'Red' }] })) as Board;
    expect(built.warnings.map((w) => w.code)).toContain('skippedEdit');
    expect(built).not.toHaveProperty('changes');
  });

  it('refuses the published base once the meet has no published schedule', async () => {
    const store = server({ athletes: roster().map(({ sessionNumber: _n, sessionPlatform: _p, ...row }) => row) });
    const options = defaultBuilderOptions(meetRow);
    expect(await failure(store.as(null)(preview, { meet: MEET, options, edits: [], base: 'published' }))).toEqual({ status: 409, error: NOT_PUBLISHED });
  });
});

describe('publishing from the published schedule', () => {
  const organizer = { meet_organizers: [{ meet: MEET, userId: 'user_a', approvedAt: 1 }] };
  const foldIn = [
    { kind: 'addAthlete', athlete: keyOf(fay), toSession: 1, toPlatform: 'Red' },
    { kind: 'removeAthlete', athlete: keyOf(dan), fromSession: 2, fromPlatform: 'Red', occurrence: 0 },
  ];

  it('adds the placed new entrants, deletes the removed lifters and leaves the unplaced ones off', async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    const options = await publishedOptions(store);
    const answer = (await store.as('user_a')(publish, { meet: MEET, options, edits: foldIn, base: 'published', baseVersion: null })) as { status: string; version: string };
    expect(answer.status).toBe('live');
    const athletes = store.rows('athletes');
    expect(athletes.find((a) => a.name === 'Fay Lund')).toMatchObject({ memberId: '109', gender: 'Women', sessionNumber: 1, sessionPlatform: 'Red', adaptive: false });
    expect(athletes.map((a) => a.name)).not.toContain('Dan Fox');
    expect(athletes.map((a) => a.name)).not.toContain('Gus Mora');
    expect(athletes.find((a) => a.name === 'Eve Gray')).toMatchObject({ sessionNumber: 2 });
    expect(store.rows('session_schedule').map((r) => [r.sessionId, r.weightClass])).toEqual([
      [1, 'W 58'],
      [2, 'M 89'],
      [3, 'W 63 B'],
      [4, 'W 63 A'],
    ]);
    expect(store.rows('schedule_publications')).toEqual([expect.objectContaining({ base: 'published', baseVersion: null, status: 'live' })]);
    expect(answer.version).toBe(String(store.docs('schedule_publications')[0]?._id));
    expect(((await store.as(null)(defaults, { meet: MEET })) as { published: { version: string } }).published.version).toBe(answer.version);
  });

  it('refuses a publish whose base someone else has published over since', async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    const options = await publishedOptions(store);
    await store.as('user_a')(publish, { meet: MEET, options, edits: [], base: 'published', baseVersion: null });
    expect(await failure(store.as('user_a')(publish, { meet: MEET, options, edits: foldIn, base: 'published', baseVersion: null }))).toEqual({ status: 409, error: STALE_BASE });
  });

  it('refuses to approve a publish whose base was published over while it waited', async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    const options = await publishedOptions(store);
    await store.as('user_b')(publish, { meet: MEET, options, edits: foldIn, base: 'published', baseVersion: null });
    const pendingId = String(store.docs('schedule_publications')[0]?._id);
    await store.as('user_a')(publish, { meet: MEET, options, edits: [], base: 'published', baseVersion: null });
    expect(await failure(store.as(null)(approve, { publicationId: pendingId }))).toEqual({ status: 409, error: STALE_APPROVAL });
    expect(store.rows('athletes').map((a) => a.name)).toContain('Dan Fox');
  });
});
