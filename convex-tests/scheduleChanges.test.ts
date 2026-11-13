import { ConvexError } from 'convex/values';
import { changes, defaults, NOT_PUBLISHED, preview, saveDraft } from '../convex/scheduleBuilder';
import { approve, BASE_GONE, decideByToken, emailContent, publish, reviewByToken, STALE_APPROVAL, STALE_BASE, stillListedProblem } from '../convex/schedulePublications';
import { forgetSport80Entrants, recordSport80Entrants, replaceMeetAthletes, replaceMeetSchedule } from '../convex/ingest';
import { platformLabel, renderPublicationEmail, renderReviewPage, type PublicationEmailContent, type ReviewPageContent } from '../convex/lib/schedulePublishing';
import { sha256Hex } from '../convex/lib/tokens';
import { buildFromPublished, buildSchedule, sport80Diff, type PublishedBase } from '../convex/lib/scheduleBuilder';
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
  sessions: { id: number; number: number; groups: { platform: string; label: string; ownTimes?: string | null; athletes: { name: string; withdrawn?: boolean }[] }[] }[];
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

async function opened(store: ReturnType<typeof server>): Promise<{ options: BuilderOptions; version: string | null }> {
  const answer = (await store.as(null)(defaults, { meet: MEET })) as { published: { options: BuilderOptions; version: string | null } | null };
  if (!answer.published) throw new Error('the meet should be published');
  return answer.published;
}

const organizer = { meet_organizers: [{ meet: MEET, userId: 'user_a', approvedAt: 1 }] };
const foldIn = [
  { kind: 'addAthlete', athlete: keyOf(fay), toSession: 1, toPlatform: 'Red' },
  { kind: 'removeAthlete', athlete: keyOf(dan), fromSession: 2, fromPlatform: 'Red', occurrence: 0 },
];

async function publishAs(store: ReturnType<typeof server>, who: string, base: 'published' | 'entries', baseVersion: string | null, edits: Args[] = []) {
  const { options } = await opened(store);
  return store.as(who)(publish, { meet: MEET, options, edits, base, baseVersion }) as Promise<{ status: string; version: string | null }>;
}

const pendingId = (store: ReturnType<typeof server>) => String(store.docs('schedule_publications').find((p) => p.status === 'pending')?._id);

async function withReviewToken(store: ReturnType<typeof server>, publicationId: string) {
  const tokenHash = await sha256Hex('review-token');
  await (store.ctx.db as { patch: (id: string, value: Row) => Promise<void> }).patch(publicationId, { reviewTokenHash: tokenHash, reviewTokenExpiresAt: NOW + 60_000 });
  return { id: publicationId, tokenHash };
}

type ReviewContent = Omit<ReviewPageContent, 'publicationId' | 'token'>;

describe('publishing from the published schedule', () => {
  it('adds the placed new entrants, deletes the removed lifters and leaves the unplaced ones off', async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    expect((await opened(store)).version).toBeNull();
    const answer = await publishAs(store, 'user_a', 'published', null, foldIn);
    expect(answer).toMatchObject({ status: 'live', version: '1' });
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
    expect(store.rows('schedule_publications')).toEqual([expect.objectContaining({ base: 'published', baseVersion: null, status: 'live', added: ['Fay Lund'], removed: ['Dan Fox'] })]);
    expect((await opened(store)).version).toBe('1');
  });

  it("keeps every session's published number when a session before it empties", async () => {
    const store = server({ ...organizer, athletes: [rostered(ann, 1), rostered(cal, 2), rostered(gia, 3)], session_schedule: [scheduleRow(1, '09:00:00', 'W 58'), scheduleRow(2, '11:00:00', 'M 89'), scheduleRow(3, '13:00:00', 'W 63')] });
    const emptied = [{ kind: 'removeAthlete', athlete: keyOf(cal), fromSession: 2, fromPlatform: 'Red', occurrence: 0 }];
    expect((await board(store, emptied)).sessions.map((s) => s.number)).toEqual([1, 3]);
    await publishAs(store, 'user_a', 'published', null, emptied);
    expect(store.rows('session_schedule').map((r) => [r.sessionId, r.weightClass])).toEqual([
      [1, 'W 58'],
      [3, 'W 63'],
    ]);
    expect(store.rows('athletes').map((a) => [a.name, a.sessionNumber])).toEqual([
      ['Ann Lee', 1],
      ['Gia Hu', 3],
    ]);
  });

  it('keeps the numbers of a hand-loaded schedule, out of time order too', async () => {
    const store = server({ athletes: [rostered(ann, 5), rostered(cal, 2)], session_schedule: [scheduleRow(5, '09:00:00', 'W 58'), scheduleRow(2, '11:00:00', 'M 89')] });
    expect((await board(store)).sessions.map((s) => [s.number, s.groups[0]?.label])).toEqual([
      [5, 'W 58'],
      [2, 'M 89'],
    ]);
  });

  it('takes off exactly the lifter removed when two share an identity, and keeps the other in their session', async () => {
    const sam = (weightClass: string, session: number) => rostered({ memberId: 'noid:sam-lee', name: 'Sam Lee', gender: 'Women', weightClass, entryTotal: 80 }, session);
    for (const [removeFrom, keptIn, keptClass] of [
      [2, 1, '58'],
      [1, 2, '63'],
    ] as const) {
      const store = server({
        ...organizer,
        athletes: [sam('63', 2), sam('58', 1), rostered(cal, 3)],
        session_schedule: [scheduleRow(1, '09:00:00', 'W 58'), scheduleRow(2, '11:00:00', 'W 63'), scheduleRow(3, '13:00:00', 'M 89')],
      });
      await publishAs(store, 'user_a', 'published', null, [{ kind: 'removeAthlete', athlete: 'noid:sam-lee|sam lee', fromSession: removeFrom, fromPlatform: 'Red', occurrence: 0 }]);
      expect(store.rows('athletes').filter((a) => a.name === 'Sam Lee').map((a) => [a.sessionNumber, a.weightClass])).toEqual([[keptIn, keptClass]]);
    }
  });

  it('refuses a publish whose base someone else has published over since', async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    await publishAs(store, 'user_a', 'published', null);
    expect(await failure(publishAs(store, 'user_a', 'published', null, foldIn))).toEqual({ status: 409, error: STALE_BASE });
  });

  it('refuses any publish, from scratch too, once a start list or schedule was loaded by hand since it was opened', async () => {
    const store = server(organizer);
    const { version } = await opened(store);
    await store.as(null)(replaceMeetSchedule, { meet: MEET, rows: publishedRows().map((row) => ({ ...row, startTime: '10:00:00' })) });
    expect(await failure(publishAs(store, 'user_a', 'published', version))).toEqual({ status: 409, error: STALE_BASE });
    expect(await failure(publishAs(store, 'user_a', 'entries', version))).toEqual({ status: 409, error: STALE_BASE });
    expect(await publishAs(store, 'user_a', 'published', '1')).toMatchObject({ status: 'live', version: '2' });
  });

  it('refuses to approve a publication made before the schedule changed', async () => {
    for (const change of ['publish', 'handLoad'] as const) {
      const store = server(organizer);
      await store.record(sport80Today());
      await publishAs(store, 'user_b', 'published', null, foldIn);
      const waiting = pendingId(store);
      if (change === 'publish') await publishAs(store, 'user_a', 'published', null);
      else await store.as(null)(replaceMeetAthletes, { meet: MEET, rows: roster(), allowUnchecked: true });
      expect(await failure(store.as(null)(approve, { publicationId: waiting }))).toEqual({ status: 409, error: STALE_APPROVAL });
      expect(store.rows('athletes').map((a) => a.name)).toContain('Dan Fox');
    }
  });

  it('lets someone who does not organize the meet take off only lifters Sport80 no longer lists', async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    const takeOffAnn = [{ kind: 'removeAthlete', athlete: keyOf(ann), fromSession: 1, fromPlatform: 'Red', occurrence: 0 }];
    expect(await failure(publishAs(store, 'user_b', 'published', null, takeOffAnn))).toEqual({ status: 400, error: stillListedProblem(['Ann Lee']) });
    expect(stillListedProblem(['Ann Lee'])).toBe('Ann Lee is still on Sport80, and only lifters Sport80 no longer lists can be taken off the start list before the publisher organizes this meet.');
    expect(await publishAs(store, 'user_b', 'published', null, foldIn)).toMatchObject({ status: 'pending', version: null });
    expect(await publishAs(store, 'user_a', 'published', null, takeOffAnn)).toMatchObject({ status: 'live' });
  });

  it('names the lifters a publication adds and takes off, in its email and on its review page', async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    await publishAs(store, 'user_b', 'published', null, foldIn);
    const publicationId = pendingId(store);
    const email = (await store.as(null)(emailContent, { publicationId })) as PublicationEmailContent;
    expect(email.changes).toEqual({ added: ['Fay Lund'], removed: ['Dan Fox'] });
    const { html } = renderPublicationEmail(email);
    expect(html).toContain('<p>Adds to the start list: Fay Lund.</p>');
    expect(html).toContain('<p>Takes off the start list: Dan Fox.</p>');
    const review = (await store.as(null)(reviewByToken, await withReviewToken(store, publicationId))) as ReviewContent;
    expect(review).toMatchObject({ changes: { added: ['Fay Lund'], removed: ['Dan Fox'] }, problem: null });
    const page = renderReviewPage({ ...review, publicationId, token: 'review-token' });
    expect(page).toContain('Adds to the start list: Fay Lund.');
    expect(page).toContain('Takes off the start list: Dan Fox.');
    expect(page).toContain('value="approve"');
  });

  it('emails a live publication as it was written, without applying its edits a second time', async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    await publishAs(store, 'user_a', 'published', null, [{ kind: 'swapSessions', session: 1, withSession: 2 }, ...foldIn.slice(0, 1).map((edit) => ({ ...edit, toSession: 2 }))]);
    const publicationId = String(store.docs('schedule_publications')[0]?._id);
    const email = (await store.as(null)(emailContent, { publicationId })) as PublicationEmailContent;
    const written = store.rows('session_schedule').map((row) => [row.sessionId, row.weightClass]);
    expect(email.schedule.sessions.flatMap((session) => session.groups.map((group) => [session.number, platformLabel(group)]))).toEqual(written);
    expect(written.slice(0, 2)).toEqual([
      [1, 'M 89, 96'],
      [2, 'W 58'],
    ]);
    expect(email.schedule.warnings.map((warning) => warning.code)).not.toContain('skippedEdit');
    expect(email.changes).toEqual({ added: ['Fay Lund'], removed: [] });
  });

  it("says on the review page that a publication made on a schedule that's gone can't be approved", async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    await publishAs(store, 'user_b', 'published', null, foldIn);
    const publicationId = pendingId(store);
    await store.as(null)(replaceMeetAthletes, { meet: MEET, rows: roster().map(({ sessionNumber: _n, sessionPlatform: _p, ...row }) => row), allowUnchecked: true });
    const review = (await store.as(null)(reviewByToken, await withReviewToken(store, publicationId))) as ReviewContent;
    expect(review.problem).toBe(BASE_GONE);
    const page = renderReviewPage({ ...review, publicationId, token: 'review-token' });
    expect(page).toContain(BASE_GONE);
    expect(page).not.toContain('value="approve"');
    expect(page).toContain('value="reject"');
  });
});

describe('rebuilding a published meet from scratch', () => {
  it("regroups the start list with Sport80's new lifters and without the withdrawn, and writes both", async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    const { options, version } = await opened(store);
    const built = (await store.as(null)(preview, { meet: MEET, options, edits: [], base: 'entries' })) as Board;
    const names = built.sessions.flatMap((s) => s.groups.flatMap((g) => g.athletes.map((a) => a.name)));
    expect(names).toEqual(expect.arrayContaining(['Fay Lund', 'Gus Mora', 'Eve Gray', 'Ann Lee']));
    expect(names).not.toContain('Dan Fox');
    expect(built.athletes).toBe(9);
    expect(await publishAs(store, 'user_a', 'entries', version)).toMatchObject({ status: 'live', version: '1' });
    const athletes = store.rows('athletes');
    expect(athletes.map((a) => a.name)).not.toContain('Dan Fox');
    expect(athletes.filter((a) => a.name === 'Fay Lund' || a.name === 'Gus Mora').every((a) => typeof a.sessionNumber === 'number')).toBe(true);
    expect(store.rows('schedule_publications')).toEqual([expect.objectContaining({ base: 'entries', baseVersion: null, added: ['Fay Lund', 'Gus Mora'], removed: ['Dan Fox'] })]);
  });
});

describe('lifters without a member id', () => {
  it('match by name and gender when either side has no member id, so nobody reads as new and withdrawn at once', async () => {
    const store = server({
      athletes: [rostered({ ...ann, memberId: 'noid:ann-lee' }, 1), rostered(bea, 1), rostered(cal, 2)],
      session_schedule: [scheduleRow(1, '09:00:00', 'W 58'), scheduleRow(2, '11:00:00', 'M 89')],
    });
    await store.record([listed(ann), listed({ ...bea, memberId: 'noid:bea-cho' }), listed(cal)]);
    expect(await store.as(null)(changes, { meet: MEET })).toEqual({ checkedAt: NOW, added: [], withdrawn: [] });
  });
});

describe('hand-loaded platform names', () => {
  const longName = 'The Main Competition Platform By The Doors';
  const handLoaded = () =>
    server({
      athletes: [rostered(ann, 1), rostered(cal, 1, { sessionPlatform: 'red' }), rostered(gia, 2, { sessionPlatform: longName })],
      session_schedule: [scheduleRow(1, '09:00:00', 'W 58'), { ...scheduleRow(1, '09:00:00', 'M 89'), platform: 'red' }, { ...scheduleRow(2, '11:00:00', 'W 63'), platform: longName }],
    });

  it('are taken as they are on the published schedule, and still checked when building from scratch', async () => {
    const store = handLoaded();
    const { options } = await opened(store);
    expect(options.platforms).toEqual(['Red', 'red', longName]);
    expect((await board(store)).sessions.map((s) => s.groups.map((g) => g.platform))).toEqual([['Red', 'red'], [longName]]);
    expect(await failure(store.as(null)(preview, { meet: MEET, options, edits: [], base: 'entries' }))).toMatchObject({ status: 400 });
  });
});

describe('what opening the builder reads', () => {
  it("reads neither the meet's publications nor its Sport80 list", async () => {
    const quiet = server();
    const busy = server({
      sport80_entrants: Array.from({ length: 200 }, (_, i) => listed({ ...ann, memberId: String(5000 + i), name: `Lifter ${i}` })),
      sport80_entrant_checks: [{ meet: MEET, checkedAt: 1, count: 200 }],
      schedule_publications: Array.from({ length: 40 }, (_, i) => ({ meet: MEET, userId: 'user_a', options: defaultBuilderOptions(meetRow), edits: [], status: 'superseded', createdAt: i })),
    });
    const readsOf = async (store: ReturnType<typeof server>) => {
      const before = store.reads.count;
      await store.as(null)(defaults, { meet: MEET });
      return store.reads.count - before;
    };
    expect(await readsOf(busy)).toBe(await readsOf(quiet));
  });
});

describe('republishing a hand-loaded schedule', () => {
  const handRow = (sessionId: number, platform: string, startTime: string, weighInTime: string, weightClass: string) => ({ meet: MEET, date: '2027-03-06', sessionId, startTime, weighInTime, platform, weightClass });
  const handRows = () => [
    handRow(1, 'Red', '09:00:00', '07:30:00', "Women's 58 kg"),
    handRow(1, 'Blue', '09:30:00', '08:00:00', 'M 89, 96'),
    handRow(2, 'Red', '11:00:00', '09:30:00', 'W 63'),
  ];
  const handLoaded = () =>
    server({
      ...organizer,
      athletes: [rostered(ann, 1), rostered(bea, 1), rostered(cal, 1, { sessionPlatform: 'Blue' }), rostered(dan, 1, { sessionPlatform: 'Blue' }), rostered(gia, 2)],
      session_schedule: handRows(),
    });
  const scheduleRows = (store: ReturnType<typeof server>) => store.rows('session_schedule').sort((a, b) => Number(a.sessionId) - Number(b.sessionId) || String(a.platform).localeCompare(String(b.platform)));

  it("writes every row an edit didn't touch back exactly as it was, weigh-in, start and label included", async () => {
    const store = handLoaded();
    await store.record([listed(ann), listed(bea), listed(cal), listed(dan), listed(gia), listed(fay)]);
    const shown = await board(store);
    expect(shown.sessions[0]?.groups.map((g) => [g.label, g.ownTimes])).toEqual([
      ["Women's 58 kg", null],
      ['M 89, 96', 'Weigh-In 8:00 AM · Start 9:30 AM'],
    ]);
    await publishAs(store, 'user_a', 'published', null, [{ kind: 'addAthlete', athlete: keyOf(fay), toSession: 2, toPlatform: 'Red' }]);
    const [blue, red, second] = scheduleRows(store);
    expect([blue, red]).toEqual([handRows()[1], handRows()[0]]);
    expect(second).toMatchObject({ sessionId: 2, startTime: '11:00:00', weighInTime: '09:30:00' });
    expect(second?.weightClass).not.toBe('W 63');
  });

  it('works out the times again only for a session an edit retimed', async () => {
    const store = handLoaded();
    await publishAs(store, 'user_a', 'published', null, [{ kind: 'setSessionTime', session: 2, date: '2027-03-06', startTime: '13:00' }]);
    const [blue, red, second] = scheduleRows(store);
    expect([blue, red]).toEqual([handRows()[1], handRows()[0]]);
    expect(second).toMatchObject({ sessionId: 2, startTime: '13:00:00', weighInTime: '11:00:00', weightClass: 'W 63' });
  });
});

describe("the schedule's version", () => {
  it('refuses a publish once a schedule was loaded by hand after the page opened on a meet without one', async () => {
    const store = server({ ...organizer, athletes: roster().map(({ sessionNumber: _n, sessionPlatform: _p, ...row }) => row), session_schedule: [] });
    const opened = (await store.as(null)(defaults, { meet: MEET })) as { version: string | null; published: unknown };
    expect(opened).toMatchObject({ version: null, published: null });
    await store.as(null)(replaceMeetSchedule, { meet: MEET, rows: publishedRows() });
    const options = defaultBuilderOptions(meetRow);
    expect(await failure(store.as('user_a')(publish, { meet: MEET, options, edits: [], base: 'entries', baseVersion: null }))).toEqual({ status: 409, error: STALE_BASE });
  });

  it('refuses a publish and an approval once a roster without sessions was loaded by hand', async () => {
    const store = server(organizer);
    const options = defaultBuilderOptions(meetRow);
    expect(await store.as('user_a')(publish, { meet: MEET, options, edits: [], base: 'entries', baseVersion: null })).toMatchObject({ status: 'live', version: '1' });
    expect(await store.as('user_b')(publish, { meet: MEET, options, edits: [], base: 'entries', baseVersion: '1' })).toMatchObject({ status: 'pending' });
    const waiting = pendingId(store);
    await store.as(null)(replaceMeetAthletes, { meet: MEET, rows: roster().map(({ sessionNumber: _n, sessionPlatform: _p, ...row }) => row), allowUnchecked: true });
    expect(await failure(store.as('user_a')(publish, { meet: MEET, options, edits: [], base: 'entries', baseVersion: '1' }))).toEqual({ status: 409, error: STALE_BASE });
    expect(await failure(store.as(null)(approve, { publicationId: waiting }))).toEqual({ status: 409, error: STALE_APPROVAL });
  });
});

describe('rebuilding from the start list', () => {
  it('leaves off a lifter without a session whom Sport80 no longer lists, and brings back one it still lists', async () => {
    const hal: Lifter = { memberId: '111', name: 'Hal Off', gender: 'Men', weightClass: '89', entryTotal: 140 };
    const ivy: Lifter = { memberId: '112', name: 'Ivy Back', gender: 'Women', weightClass: '58', entryTotal: 75 };
    const unscheduled = (lifter: Lifter) => ({ ...entrant(lifter), meet: MEET, adaptive: false });
    const store = server({ ...organizer, athletes: [...roster(), unscheduled(hal), unscheduled(ivy)] });
    await store.record([...sport80Today(), listed(ivy)]);
    const answer = (await store.as(null)(changes, { meet: MEET })) as Board['changes'];
    expect(answer.added.map((a) => a.athlete.name)).toContain('Ivy Back');
    const { options, version } = await opened(store);
    const built = (await store.as(null)(preview, { meet: MEET, options, edits: [], base: 'entries' })) as Board;
    const names = built.sessions.flatMap((s) => s.groups.flatMap((g) => g.athletes.map((a) => a.name)));
    expect(names).toContain('Ivy Back');
    expect(names).not.toContain('Hal Off');
    await publishAs(store, 'user_a', 'entries', version);
    expect(store.rows('athletes').filter((a) => a.name === 'Ivy Back')).toEqual([expect.objectContaining({ sessionNumber: expect.any(Number) })]);
    expect(store.rows('athletes').find((a) => a.name === 'Hal Off')?.sessionNumber).toBeUndefined();
  });
});

describe('a draft on the published schedule', () => {
  it("is checked against the meet's own published platform names, not the ones it sends", async () => {
    const longName = 'The Main Competition Platform By The Doors';
    const store = server({
      athletes: [rostered(ann, 1), rostered(gia, 2, { sessionPlatform: longName })],
      session_schedule: [scheduleRow(1, '09:00:00', 'W 58'), { ...scheduleRow(2, '11:00:00', 'W 63'), platform: longName }],
    });
    const { options } = await opened(store);
    const save = (platforms: string[]) => store.as('user_a')(saveDraft, { meet: MEET, options: { ...options, platforms }, edits: [], base: 'published', baseVersion: null });
    expect(await save(['Red', longName])).toMatchObject({ meet: MEET });
    expect(await failure(save(['Red', '']))).toMatchObject({ status: 400 });
    expect(await failure(save(['Red', 'x'.repeat(31)]))).toMatchObject({ status: 400 });
  });
});

describe('approving a publication whose published schedule is gone', () => {
  it('says so to the reviewer, from the CLI and from the review link', async () => {
    const store = server(organizer);
    await store.record(sport80Today());
    await publishAs(store, 'user_b', 'published', null, foldIn);
    const publicationId = pendingId(store);
    await store.as(null)(replaceMeetAthletes, { meet: MEET, rows: roster().map(({ sessionNumber: _n, sessionPlatform: _p, ...row }) => row), allowUnchecked: true });
    expect(await failure(store.as(null)(approve, { publicationId }))).toEqual({ status: 409, error: BASE_GONE });
    const token = await withReviewToken(store, publicationId);
    expect(await failure(store.as(null)(decideByToken, { ...token, decision: 'approve' }))).toEqual({ status: 409, error: BASE_GONE });
  });
});

const handRow = (sessionId: number, platform: string, startTime: string, weighInTime: string, weightClass: string, date = '2027-03-06') => ({ meet: MEET, date, sessionId, startTime, weighInTime, platform, weightClass });
const inRowOrder = (list: readonly Row[]) =>
  [...list].sort((a, b) => Number(a.sessionId) - Number(b.sessionId) || String(a.platform).localeCompare(String(b.platform)) || String(a.startTime).localeCompare(String(b.startTime)));
const sortedRows = (store: ReturnType<typeof server>) => inRowOrder(store.rows('session_schedule'));

describe('published rows without a lifter of their own', () => {
  const rows = () => [
    handRow(1, 'Red', '12:00:00', '10:00:00', 'W 58'),
    handRow(1, 'Green', '12:00:00', '10:00:00', 'Spare platform'),
    handRow(2, 'Red', '14:00:00', '12:00:00', 'M 89'),
    handRow(3, 'Red', '09:00:00', '07:00:00', 'W 59'),
    handRow(3, 'Red', '10:00:00', '08:00:00', 'W 64'),
  ];
  const handLoaded = () => server({ ...organizer, athletes: [rostered(ann, 1), rostered(cal, 2), rostered(gia, 3)], session_schedule: rows() });
  const untouched = (list: Row[]) => list.filter((row) => row.platform === 'Green' || row.sessionId === 3);

  it('are written back exactly, two rows of one session and platform and a platform nobody lifts on included', async () => {
    const store = handLoaded();
    expect((await board(store)).sessions.find((s) => s.id === 3)?.groups[0]?.label).toBe('W 59 / W 64');
    await publishAs(store, 'user_a', 'published', null);
    expect(sortedRows(store)).toEqual(inRowOrder(rows()));
  });

  it('are written back exactly when an edit changes another session', async () => {
    const store = handLoaded();
    await publishAs(store, 'user_a', 'published', null, [{ kind: 'moveAthlete', athlete: keyOf(ann), fromSession: 1, fromPlatform: 'Red', occurrence: 0, toSession: 2, toPlatform: 'Red' }]);
    expect(untouched(sortedRows(store))).toEqual(inRowOrder(untouched(rows())));
  });
});

describe('platforms of one session at their own times', () => {
  const base = (): PublishedBase => ({
    rows: [handRow(1, 'Red', '09:00:00', '07:30:00', 'W 58'), handRow(1, 'Blue', '09:30:00', '08:00:00', 'M 89')],
    roster: [
      { ...rostered(ann, 1), _id: 'ann' },
      { ...rostered(cal, 1, { sessionPlatform: 'Blue' }), _id: 'cal' },
    ],
    sport80: null,
  });

  it("are shown in the email's lines, and the session takes its times from the platforms it still holds", () => {
    const published = base();
    const options = { ...defaultBuilderOptions(meetRow), platforms: ['Red', 'Blue'] };
    const built = buildFromPublished(published, sport80Diff(published), options);
    expect(built.sessions[0]).toMatchObject({ startTime: '09:00:00', weighInTime: '07:30:00' });
    const { html } = renderPublicationEmail({ meet: MEET, status: 'live', userId: 'u', schedule: built, changes: { added: [], removed: [] }, lastLiveAt: null, hasSchedule: true });
    expect(html).toContain('Red: W 58 (1); Blue (Weigh-In 8:00 AM · Start 9:30 AM): M 89 (1)');
    const emptied = buildFromPublished(published, sport80Diff(published), options, [
      { kind: 'moveAthlete', athlete: keyOf(ann), fromSession: 1, fromPlatform: 'Red', occurrence: 0, toSession: 1, toPlatform: 'Blue' },
    ]);
    expect(emptied.sessions[0]).toMatchObject({ startTime: '09:30:00', weighInTime: '08:00:00' });
  });
});

describe('a split class an edit changed part of', () => {
  it('loses its letters in every part, the parts no edit touched too', async () => {
    const store = server(organizer);
    await publishAs(store, 'user_a', 'published', null, [{ kind: 'moveAthlete', athlete: keyOf(ida), fromSession: 4, fromPlatform: 'Red', occurrence: 0, toSession: 1, toPlatform: 'Red' }]);
    expect(store.rows('session_schedule').filter((row) => row.sessionId === 3 || row.sessionId === 4).map((row) => [row.sessionId, row.weightClass])).toEqual([
      [3, 'W 63'],
      [4, 'W 63'],
    ]);
  });
});

describe('overlaps on a hand-loaded schedule', () => {
  const handLoaded = () =>
    server({ athletes: [rostered(ann, 1), rostered(cal, 2)], session_schedule: [handRow(1, 'Red', '09:00:00', '07:00:00', 'W 58'), handRow(2, 'Red', '10:45:00', '08:45:00', 'M 89')] });

  it('are not warned about unless an edit retimed a session, and the session length comes from the rows', async () => {
    const store = handLoaded();
    expect((await opened(store)).options.sessionMinutes).toBe(105);
    expect((await board(store)).warnings.map((w) => w.code)).not.toContain('overlap');
    const retimed = await board(store, [{ kind: 'setSessionTime', session: 2, date: '2027-03-06', startTime: '10:00' }]);
    expect(retimed.warnings.map((w) => w.code)).toContain('overlap');
  });
});

describe('an added entrant already on the roster without a session', () => {
  it('is placed on that row, matched by name and gender when it has no member id, not added again', async () => {
    const jane: Lifter = { memberId: 'noid:jane-doe', name: 'Jane Doe', gender: 'Women', weightClass: '58', entryTotal: 85 };
    const store = server({ ...organizer, athletes: [...roster(), { ...entrant(jane), meet: MEET, adaptive: false }] });
    await store.record([...sport80Today(), listed({ ...jane, memberId: '120' })]);
    await publishAs(store, 'user_a', 'published', null, [{ kind: 'addAthlete', athlete: '120|jane doe', toSession: 1, toPlatform: 'Red' }]);
    expect(store.rows('athletes').filter((a) => a.name === 'Jane Doe').map((a) => [a.memberId, a.sessionNumber, a.sessionPlatform])).toEqual([['noid:jane-doe', 1, 'Red']]);
  });
});

