import { ConvexError } from 'convex/values';
import { getFunctionName } from 'convex/server';
import { approve, decideByToken, email, emailContent, markEmailed, pending, publications, publish, reject, reviewByToken, reviewDecisionHttp, reviewPageHttp, setReviewToken } from '../convex/schedulePublications';
import { buildSchedule } from '../convex/lib/scheduleBuilder';
import { defaultBuilderOptions, type BuilderOptions } from '../convex/lib/scheduleBuilderOptions';
import { MAX_PUBLISHES_PER_DAY, platformLabel, publishedSchedule, publishProblem, renderPublicationEmail, reviewUrl } from '../convex/lib/schedulePublishing';
import { EMAIL_RETRY_DELAYS_MS, sendEmail } from '../convex/lib/email';
import { sha256Hex } from '../convex/lib/tokens';
import { fakeMutationCtx, handlerOf } from './fakeDb';

jest.mock('../convex/lib/email', () => ({ ...jest.requireActual('../convex/lib/email'), sendEmail: jest.fn() }));
const sendEmailMock = sendEmail as jest.MockedFunction<typeof sendEmail>;

const NOW = Date.UTC(2027, 0, 10, 12);
const MEET = 'Turkey Cup';
type Args = Record<string, unknown>;

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

const athlete = (name: string, gender: string, weightClass: string, entryTotal: number, extra: Args = {}) => ({
  memberId: `${name.length}${entryTotal}`,
  name,
  age: 30,
  club: 'Club',
  gender,
  weightClass,
  entryTotal,
  meet: MEET,
  adaptive: false,
  ...extra,
});

const roster = () => [athlete('Ann', 'Women', '58', 80), athlete('Bea', 'Women', '63', 90), athlete('Cal', 'Men', '89', 150)];
const options = (extra: Partial<BuilderOptions> = {}): BuilderOptions => ({ ...defaultBuilderOptions(meetRow), maxAthletesPerPlatform: 5, ...extra });

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  sendEmailMock.mockReset().mockResolvedValue('sent');
});
afterEach(() => jest.restoreAllMocks());

function server(seed: Record<string, Record<string, unknown>[]> = {}) {
  const store = fakeMutationCtx({ meets: [meetRow], athletes: roster(), ...seed });
  const as = (subject: string | null) => {
    const ctx = { ...store.ctx, auth: { getUserIdentity: async () => (subject === null ? null : { subject }) } };
    return (fn: unknown, args: Args = {}) => handlerOf<Args>(fn)(ctx, args) as Promise<unknown>;
  };
  const functions: Record<string, unknown> = {
    'schedulePublications:emailContent': emailContent,
    'schedulePublications:setReviewToken': setReviewToken,
    'schedulePublications:markEmailed': markEmailed,
    'schedulePublications:reviewByToken': reviewByToken,
    'schedulePublications:decideByToken': decideByToken,
  };
  const run = (fn: unknown, args: Args) => {
    const registered = functions[getFunctionName(fn as never)];
    if (!registered) throw new Error(`no test handler for ${getFunctionName(fn as never)}`);
    return handlerOf<Args>(registered)(store.ctx, args);
  };
  const actionCtx = { ...store.ctx, runQuery: run, runMutation: run };
  return { ...store, as, action: (fn: unknown, args: Args) => handlerOf<Args>(fn)(actionCtx, args), http: (fn: unknown, request: Request) => handlerOf<Request, Response>(fn)(actionCtx, request) };
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

const sessionsOf = (store: ReturnType<typeof server>) =>
  store
    .rows('athletes')
    .map((a) => [a.name, a.sessionNumber ?? null, a.sessionPlatform ?? null])
    .sort();

describe('what a publish writes', () => {
  it('labels each platform by gender, classes, split and age group', () => {
    expect(platformLabel({ gender: 'Female', weightClasses: ['48', '53'], split: '', ageGroup: '' })).toBe('W 48, 53');
    expect(platformLabel({ gender: 'Male', weightClasses: ['89'], split: 'A', ageGroup: 'masters' })).toBe('M 89 A (Masters)');
    expect(platformLabel({ gender: 'Male', weightClasses: ['55'], split: '', ageGroup: 'youth' })).toBe('M 55 (Youth)');
  });

  it('turns a schedule into schedule rows and each athlete’s session', () => {
    const published = publishedSchedule(buildSchedule(roster(), options()));
    expect(published.rows).toEqual([
      { date: '2027-03-06', sessionId: 1, startTime: '09:00:00', weighInTime: '07:00:00', platform: 'Red', weightClass: 'W 58, 63' },
      { date: '2027-03-06', sessionId: 2, startTime: '11:00:00', weighInTime: '09:00:00', platform: 'Red', weightClass: 'M 89' },
    ]);
    expect(published.placements.map((p) => [p.name, p.sessionNumber, p.platform])).toEqual([
      ['Ann', 1, 'Red'],
      ['Bea', 1, 'Red'],
      ['Cal', 2, 'Red'],
    ]);
  });

  it('refuses a schedule with no entrants or with sessions left without a time', () => {
    expect(publishProblem(buildSchedule([], options()))).toBe('the meet has no entrants to publish yet');
    expect(publishProblem(buildSchedule(roster(), options({ maxAthletesPerPlatform: 1, maxSessionsPerDay: 1 })))).toBe(
      "2 sessions have no time; fit every session into the meet's days before publishing",
    );
    expect(publishProblem(buildSchedule(roster(), options()))).toBeNull();
  });
});

describe('publish', () => {
  it('holds a first publish for review without changing the meet, and emails it', async () => {
    const store = server();
    expect(await store.as('user_a')(publish, { meet: MEET, options: options(), edits: [], contactEmail: 'coach@example.com' })).toEqual({ status: 'pending', sessions: 2, athletes: 3 });
    expect(store.rows('session_schedule')).toEqual([]);
    expect(sessionsOf(store).every(([, session]) => session === null)).toBe(true);
    expect(store.rows('schedule_publications').map((p) => [p.status, p.contactEmail])).toEqual([['pending', 'coach@example.com']]);
    expect(store.scheduled.map((s) => s.name)).toEqual(['schedulePublications:email']);
    expect(await store.as('user_a')(publications, { meet: MEET })).toMatchObject({ organizer: false, publications: [{ status: 'pending', decidedAt: null }] });
  });

  it("supersedes the same user's earlier pending publish of the meet", async () => {
    const store = server();
    await store.as('user_a')(publish, { meet: MEET, options: options(), edits: [] });
    await store.as('user_a')(publish, { meet: MEET, options: options({ platforms: ['Red', 'Blue'] }), edits: [] });
    expect(store.rows('schedule_publications').map((p) => p.status)).toEqual(['superseded', 'pending']);
  });

  it("puts an organizer's publish live at once", async () => {
    const store = server({ meet_organizers: [{ meet: MEET, userId: 'user_a', approvedAt: 1 }] });
    expect(await store.as('user_a')(publish, { meet: MEET, options: options(), edits: [] })).toEqual({ status: 'live', sessions: 2, athletes: 3 });
    expect(sessionsOf(store)).toEqual([
      ['Ann', 1, 'Red'],
      ['Bea', 1, 'Red'],
      ['Cal', 2, 'Red'],
    ]);
    expect(store.rows('session_schedule').map((r) => [r.sessionId, r.platform, r.weightClass, r.meet])).toEqual([
      [1, 'Red', 'W 58, 63', MEET],
      [2, 'Red', 'M 89', MEET],
    ]);
    expect(store.rows('view_hints').length).toBeGreaterThan(0);
  });

  it('needs sign-in, a schedule that fits, a meet not over, and a daily allowance', async () => {
    const recent = Array.from({ length: MAX_PUBLISHES_PER_DAY }, () => ({ meet: 'Other', userId: 'user_b', options: options(), edits: [], status: 'rejected', createdAt: NOW - 1000 }));
    const store = server({ schedule_publications: recent });
    expect(await failure(store.as(null)(publish, { meet: MEET, options: options(), edits: [] }))).toEqual({ status: 401, error: 'unauthorized' });
    expect(await failure(store.as('user_a')(publish, { meet: MEET, options: options({ maxAthletesPerPlatform: 1, maxSessionsPerDay: 1 }), edits: [] }))).toMatchObject({ status: 400 });
    expect(await failure(store.as('user_a')(publish, { meet: MEET, options: options(), edits: [], contactEmail: 'nope' }))).toEqual({ status: 400, error: 'contact email is not an email address' });
    expect(await failure(store.as('user_b')(publish, { meet: MEET, options: options(), edits: [] }))).toMatchObject({ status: 429 });
    const over = server({ meets: [{ ...meetRow, status: 'completed' }] });
    expect(await failure(over.as('user_a')(publish, { meet: MEET, options: options(), edits: [] }))).toMatchObject({ status: 409 });
  });
});

describe('review', () => {
  async function pendingPublication(store: ReturnType<typeof server>, extra: Partial<BuilderOptions> = {}) {
    await store.as('user_a')(publish, { meet: MEET, options: options(extra), edits: [] });
    const [row] = store.docs('schedule_publications');
    return String(row?._id);
  }

  it('approves from the CLI: the schedule goes live and the publisher becomes the organizer', async () => {
    const store = server();
    const publicationId = await pendingPublication(store);
    expect(await store.as(null)(pending)).toEqual([{ publicationId, meet: MEET, userId: 'user_a', contactEmail: null, createdAt: NOW }]);
    expect(await store.as(null)(approve, { publicationId })).toEqual({ status: 'approved', message: "The schedule is live, and its publisher is now the meet's organizer." });
    expect(sessionsOf(store).map(([, session]) => session)).toEqual([1, 1, 2]);
    expect(store.rows('meet_organizers').map((o) => [o.meet, o.userId])).toEqual([[MEET, 'user_a']]);
    expect(await store.as(null)(approve, { publicationId })).toEqual({ status: 'approved', message: 'This schedule is already approved.' });
    expect(await store.as(null)(pending)).toEqual([]);
  });

  it('rejects without changing the meet', async () => {
    const store = server();
    const publicationId = await pendingPublication(store);
    expect(await store.as(null)(reject, { publicationId })).toEqual({ status: 'rejected', message: 'The schedule was rejected. Nothing on MeetCal changed.' });
    expect(store.rows('session_schedule')).toEqual([]);
    expect(store.rows('meet_organizers')).toEqual([]);
  });

  it('refuses to approve once the entries no longer fit, keeping it pending', async () => {
    const store = server();
    const publicationId = await pendingPublication(store, { maxSessionsPerDay: 2 });
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) await store.db.insert('athletes', athlete(`Late ${i}`, 'Men', String(60 + i * 5), 100));
    expect(await failure(store.as(null)(approve, { publicationId }))).toMatchObject({ status: 409 });
    expect(store.rows('schedule_publications').map((p) => p.status)).toEqual(['pending']);
  });

  it('decides by a review link only with its token, before it expires, and only once', async () => {
    const store = server();
    const publicationId = await pendingPublication(store);
    await store.as(null)(setReviewToken, { publicationId, tokenHash: await sha256Hex('secret'), expiresAt: NOW + 1000 });
    expect(await store.as(null)(decideByToken, { id: publicationId, tokenHash: await sha256Hex('wrong'), decision: 'approve' })).toBeNull();
    expect(await store.as(null)(decideByToken, { id: 'not-an-id', tokenHash: await sha256Hex('secret'), decision: 'approve' })).toBeNull();
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 2000);
    expect(await store.as(null)(decideByToken, { id: publicationId, tokenHash: await sha256Hex('secret'), decision: 'approve' })).toBeNull();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(await store.as(null)(decideByToken, { id: publicationId, tokenHash: await sha256Hex('secret'), decision: 'reject' })).toMatchObject({ status: 'rejected' });
    expect(await store.as(null)(decideByToken, { id: publicationId, tokenHash: await sha256Hex('secret'), decision: 'approve' })).toBeNull();
  });

  it('shows a review page for a valid link, and acts only on a posted decision', async () => {
    const store = server();
    const publicationId = await pendingPublication(store);
    await store.as(null)(setReviewToken, { publicationId, tokenHash: await sha256Hex('secret'), expiresAt: NOW + 1000 });
    const page = await store.http(reviewPageHttp, new Request(`https://x.convex.site/schedule-builder/review?id=${publicationId}&token=secret`));
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain('<button name="decision" value="approve">Approve</button>');
    expect(body).toContain('Turkey Cup: 3 athletes in 2 sessions');
    expect(store.rows('schedule_publications').map((p) => p.status)).toEqual(['pending']);
    expect((await store.http(reviewPageHttp, new Request(`https://x.convex.site/schedule-builder/review?id=${publicationId}&token=bad`))).status).toBe(404);
    const posted = await store.http(
      reviewDecisionHttp,
      new Request('https://x.convex.site/schedule-builder/review', { method: 'POST', body: new URLSearchParams({ id: publicationId, token: 'secret', decision: 'approve' }) }),
    );
    expect(posted.status).toBe(200);
    expect(await posted.text()).toContain('The schedule is live');
    expect(store.rows('schedule_publications').map((p) => p.status)).toEqual(['approved']);
  });
});

describe('email', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, MEET_SUBMISSION_EMAIL: 'review@example.com', CONVEX_SITE_URL: 'https://x.convex.site' };
  });
  afterEach(() => {
    process.env = env;
  });

  it('sends a pending publish with a review link whose token only its hash is kept for', async () => {
    const store = server();
    await store.as('user_a')(publish, { meet: MEET, options: options(), edits: [], contactEmail: 'coach@example.com' });
    const [row] = store.docs('schedule_publications');
    await store.action(email, { publicationId: row?._id, attempt: 0 });
    const [to, subject, html, extra] = sendEmailMock.mock.calls[0] ?? [];
    expect([to, subject, extra]).toEqual(['review@example.com', 'Schedule to review: Turkey Cup', { replyTo: 'coach@example.com' }]);
    const token = /token=([0-9a-f]{64})/.exec(String(html))?.[1] ?? '';
    const [stored] = store.rows('schedule_publications');
    expect(stored?.reviewTokenHash).toBe(await sha256Hex(token));
    expect(String(html)).not.toContain(String(stored?.reviewTokenHash));
    expect(stored?.emailedAt).toBe(NOW);
    await store.action(email, { publicationId: row?._id, attempt: 0 });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("tells you about an organizer's live publish, without a link", async () => {
    const store = server({ meet_organizers: [{ meet: MEET, userId: 'user_a', approvedAt: 1 }] });
    await store.as('user_a')(publish, { meet: MEET, options: options(), edits: [] });
    const [row] = store.docs('schedule_publications');
    await store.action(email, { publicationId: row?._id, attempt: 0 });
    expect(sendEmailMock.mock.calls[0]?.[1]).toBe('Schedule updated: Turkey Cup');
    expect(String(sendEmailMock.mock.calls[0]?.[2])).not.toContain('token=');
  });

  it('retries a failed send, and sends nothing without an address', async () => {
    const store = server();
    await store.as('user_a')(publish, { meet: MEET, options: options(), edits: [] });
    const [row] = store.docs('schedule_publications');
    sendEmailMock.mockRejectedValueOnce(new Error('OneSignal down'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await store.action(email, { publicationId: row?._id, attempt: 0 });
    expect(store.scheduled.at(-1)).toMatchObject({ name: 'schedulePublications:email', delayMs: EMAIL_RETRY_DELAYS_MS[0] });
    process.env = { ...env, MEET_SUBMISSION_EMAIL: '' };
    sendEmailMock.mockClear();
    await store.action(email, { publicationId: row?._id, attempt: 1 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('builds review links on the deployment site', () => {
    expect(reviewUrl('https://x.convex.site/', 'id1', 'abc')).toBe('https://x.convex.site/schedule-builder/review?id=id1&token=abc');
    const schedule = buildSchedule(roster(), options());
    expect(renderPublicationEmail({ meet: '<b>Cup</b>', status: 'pending', userId: 'u', schedule }).html).toContain('&lt;b&gt;Cup&lt;/b&gt;');
  });
});
