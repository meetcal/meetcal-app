import { recordWrite, setMeetResultTitles, setMeetStatus, upsertMeets } from '../convex/ingest';
import { computeStatsRows } from '../convex/lib/meetData';
import { byMeet } from '../convex/results';
import { attendance } from '../convex/meets';
import { meetDataProblems } from '../convex/scrapers/queries';
import { fakeMutationCtx, handlerOf } from './fakeDb';

// Premium queries may log their caller (`convex/lib/access.ts`).
beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

/**
 * A combined national event (#362): one entries event, listed as the meet,
 * whose results Sport80 publishes under several titles.
 */
const NATIONALS = '2026 USA Weightlifting National Championships';
const JUNIOR = 'The 2026 National Junior Championships';
const YOUTH = 'The 2026 National Youth Championships';

const result = (name: string, meet: string, age: string, total: number) => ({
  eventId: meet,
  meet,
  date: '2026-06-20',
  name,
  nameKey: name.toLowerCase(),
  age,
  snatchBest: total / 2,
  cjBest: total / 2,
  total,
  adaptive: false,
  federation: 'USAW',
});
const athlete = (name: string, club: string, meet = NATIONALS) => ({ memberId: name, name, age: 17, club, gender: 'Women', weightClass: '64', entryTotal: 1, meet, adaptive: false });

function world() {
  return fakeMutationCtx({
    meets: [{ name: NATIONALS, startDate: '2026-06-18', endDate: '2026-06-28' }, { name: 'Other Meet' }],
    athletes: [athlete('Ann Senior', 'Club A'), athlete('Bo Junior', 'Club A'), athlete('Cy Youth', 'Club B'), athlete('Ed Other', 'Club C', 'Other Meet')],
    lifting_results: [
      result('Ann Senior', NATIONALS, "Open Women's 64kg", 200),
      result('Bo Junior', JUNIOR, "Junior Women's 64kg", 180),
      result('Cy Youth', YOUTH, "16-17 Age Group Women's 64kg", 150),
      result('Di Elsewhere', 'Unrelated Title', "Open Women's 64kg", 170),
    ],
  });
}

type Link = { meet: string; titles: string[] };
const link = handlerOf<Link, { titles: string[]; results: Record<string, number> }>(setMeetResultTitles);

describe('results titles of a meet (#362)', () => {
  it("shows a combined event's results under every linked title with the meet", async () => {
    const store = world();
    const before = JSON.parse((await handlerOf<{ meet: string }, { json: string }>(byMeet)(store.ctx, { meet: NATIONALS })).json) as unknown[];
    expect(before).toHaveLength(1);

    expect(await link(store.ctx, { meet: NATIONALS, titles: [JUNIOR, ` ${YOUTH} `, JUNIOR] })).toMatchObject({
      titles: [JUNIOR, YOUTH],
      results: { [JUNIOR]: 1, [YOUTH]: 1 },
    });
    const after = JSON.parse((await handlerOf<{ meet: string }, { json: string }>(byMeet)(store.ctx, { meet: NATIONALS })).json) as { name: string }[];
    expect(after.map((row) => row.name).sort()).toEqual(['Ann Senior', 'Bo Junior', 'Cy Youth']);

    // Club stats see the junior and youth lifters' results too.
    const stats = await computeStatsRows(store.ctx as never, NATIONALS);
    expect(stats.map((row) => [row.name, row.club, row.total]).sort()).toEqual([
      ['Ann Senior', 'Club A', 200],
      ['Bo Junior', 'Club A', 180],
      ['Cy Youth', 'Club B', 150],
    ]);
    // The meet's views are rebuilt.
    expect(store.rows('view_hints').map((h) => `${h.kind}:${h.key}`)).toContain(`meet:${NATIONALS}`);
  });

  it("marks the meet's views stale when results under a linked title change", async () => {
    const store = world();
    await link(store.ctx, { meet: NATIONALS, titles: [JUNIOR] });
    for (const row of store.docs('view_hints')) await store.ctx.db.delete(row._id as string);
    await recordWrite(store.ctx as never, 'lifting_results', [{ kind: 'meet', key: JUNIOR }]);
    expect(store.rows('view_hints').map((h) => `${h.kind}:${h.key}`).sort()).toEqual([`meet:${JUNIOR}`, `meet:${NATIONALS}`].sort());
  });

  it("counts a combined event's lifters under its linked titles in attendance", async () => {
    const store = world();
    await link(store.ctx, { meet: NATIONALS, titles: [JUNIOR, YOUTH] });
    const answer = await handlerOf<{ meets: string[] }, { json: string }>(attendance)(store.ctx, { meets: [NATIONALS] });
    expect(JSON.parse(answer.json)).toEqual([expect.objectContaining({ meet: NATIONALS, lifters: 3, registrations: 3, first_date: '2026-06-20', results_titles: [JUNIOR, YOUTH] })]);
  });

  it('looks up linked titles only for results writes', async () => {
    const store = world();
    await link(store.ctx, { meet: NATIONALS, titles: [JUNIOR] });
    for (const row of store.docs('view_hints')) await store.ctx.db.delete(row._id as string);
    await recordWrite(store.ctx as never, 'meets', [{ kind: 'meet', key: JUNIOR }]);
    expect(store.rows('view_hints').map((h) => `${h.kind}:${h.key}`)).toEqual([`meet:${JUNIOR}`]);
  });

  it('refuses a title of another meet, a meet with a roster, the meet itself or an unknown meet, and unlinks with []', async () => {
    const store = world();
    await link(store.ctx, { meet: NATIONALS, titles: [JUNIOR] });
    await expect(link(store.ctx, { meet: 'Other Meet', titles: [JUNIOR] })).rejects.toThrow('already linked');
    await expect(link(store.ctx, { meet: NATIONALS, titles: ['Other Meet'] })).rejects.toThrow('is a meet of its own (a roster), not a results title');
    await expect(link(store.ctx, { meet: NATIONALS, titles: [NATIONALS] })).rejects.toThrow("not the meet's own name");
    await expect(link(store.ctx, { meet: 'Nowhere', titles: [JUNIOR] })).rejects.toThrow('no meet named');
    await link(store.ctx, { meet: NATIONALS, titles: [] });
    expect(store.rows('meet_result_titles')).toEqual([]);
    const rows = JSON.parse((await handlerOf<{ meet: string }, { json: string }>(byMeet)(store.ctx, { meet: NATIONALS })).json) as unknown[];
    expect(rows).toHaveLength(1);
  });
});

const COMBINED = '2026 Masters National Championships & National University Championships';
const MASTERS = 'The 2026 USA Weightlifting Masters National Championships Powered by Rogue Fitness';
const UNIVERSITY = 'The 2026 National University Championships';

const meetRow = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  venueName: 'Hall',
  venueStreet: '1 Main St',
  venueCity: 'Columbus',
  venueState: 'OH',
  venueZip: '43215',
  timeZone: 'America/New_York',
  startDate: '2026-11-20',
  endDate: '2026-11-23',
  status: 'upcoming' as const,
  federation: 'USAW',
  ...extra,
});

const savedSession = (meet: string) => ({ sessionId: `${meet}-1`, userId: 'user_1', meet, sessionNumber: 1, platform: 'Red', updatedAt: 1 });
const scheduleRow = (meet: string) => ({ meet, sessionId: 1, platform: 'Red', date: '2026-11-20', weightClass: '64', startTime: '09:00', weighInTime: '07:00' });

function combinedWorld(secondary: Record<string, Record<string, unknown>[]> = {}) {
  return fakeMutationCtx({
    meets: [
      { ...meetRow(COMBINED, { status: 'completed', startDate: '2026-10-01', endDate: '2026-10-04' }), updatedAt: 1 },
      { ...meetRow(MASTERS, { startDate: '2026-12-01', endDate: '2026-12-04' }), updatedAt: 1 },
    ],
    athletes: [athlete('Ann Master', 'Club A', COMBINED), athlete('Bo Student', 'Club B', COMBINED), ...(secondary.athletes ?? [])],
    session_schedule: [scheduleRow(COMBINED), ...(secondary.session_schedule ?? [])],
    saved_sessions: [savedSession(COMBINED), ...(secondary.saved_sessions ?? [])],
    lifting_results: [
      result('Ann Master', MASTERS, "Masters Women's 35-39 64kg", 160),
      result('Ann Too', MASTERS, "Masters Women's 40-44 64kg", 150),
      result('Bo Student', UNIVERSITY, "University Women's 64kg", 170),
    ],
    meet_result_titles: secondary.meet_result_titles ?? [],
  });
}

const resultsOf = async (store: ReturnType<typeof combinedWorld>, meet: string) =>
  (JSON.parse((await handlerOf<{ meet: string }, { json: string }>(byMeet)(store.ctx, { meet })).json) as { name: string; meet: string }[]).map((row) => `${row.meet}|${row.name}`).sort();

describe('a combined meet whose results title is a meet of its own (#608)', () => {
  it('links a meet row with no roster, schedule or saved sessions, and reads each linked title once', async () => {
    const store = combinedWorld();
    expect(await link(store.ctx, { meet: COMBINED, titles: [MASTERS, UNIVERSITY] })).toMatchObject({
      titles: [MASTERS, UNIVERSITY],
      results: { [MASTERS]: 2, [UNIVERSITY]: 1 },
    });
    expect(await resultsOf(store, COMBINED)).toEqual([`${UNIVERSITY}|Bo Student`, `${MASTERS}|Ann Master`, `${MASTERS}|Ann Too`]);
    expect(await resultsOf(store, MASTERS)).toEqual([`${MASTERS}|Ann Master`, `${MASTERS}|Ann Too`]);
    const stats = await computeStatsRows(store.ctx as never, COMBINED);
    expect(stats.map((row) => [row.name, row.total]).sort()).toEqual([
      ['Ann Master', 160],
      ['Bo Student', 170],
    ]);
    const answer = await handlerOf<{ meets: string[] }, { json: string }>(attendance)(store.ctx, { meets: [COMBINED, MASTERS] });
    expect(JSON.parse(answer.json)).toEqual([
      expect.objectContaining({ meet: COMBINED, lifters: 3, registrations: 2, results_titles: [MASTERS, UNIVERSITY] }),
      expect.objectContaining({ meet: MASTERS, lifters: 2, registrations: 0, results_titles: [] }),
    ]);
  });

  it("marks both meets' views stale when results under the linked meet row change", async () => {
    const store = combinedWorld();
    await link(store.ctx, { meet: COMBINED, titles: [MASTERS] });
    for (const row of store.docs('view_hints')) await store.ctx.db.delete(row._id as string);
    await recordWrite(store.ctx as never, 'lifting_results', [{ kind: 'meet', key: MASTERS }]);
    expect(store.rows('view_hints').map((h) => `${h.kind}:${h.key}`).sort()).toEqual([`meet:${COMBINED}`, `meet:${MASTERS}`].sort());
  });

  it.each([
    ['a roster', { athletes: [athlete('Cy Master', 'Club C', MASTERS)] }],
    ['a schedule', { session_schedule: [scheduleRow(MASTERS)] }],
    ['saved sessions', { saved_sessions: [savedSession(MASTERS)] }],
  ])('refuses a meet row with %s of its own', async (what, secondary) => {
    const store = combinedWorld(secondary);
    await expect(link(store.ctx, { meet: COMBINED, titles: [UNIVERSITY, MASTERS] })).rejects.toThrow(`"${MASTERS}" is a meet of its own (${what}), not a results title`);
    expect(store.rows('meet_result_titles')).toEqual([]);
  });

  it('names everything a refused meet row has', async () => {
    const store = combinedWorld({ athletes: [athlete('Cy Master', 'Club C', MASTERS)], saved_sessions: [savedSession(MASTERS)] });
    await expect(link(store.ctx, { meet: COMBINED, titles: [MASTERS] })).rejects.toThrow('(a roster, saved sessions)');
  });

  it('refuses a title linked to another meet, a title with titles of its own, and a meet that is a results title', async () => {
    const store = combinedWorld({ meet_result_titles: [{ meet: 'Elsewhere', title: UNIVERSITY }] });
    await expect(link(store.ctx, { meet: COMBINED, titles: [UNIVERSITY] })).rejects.toThrow(`"${UNIVERSITY}" is already linked to "Elsewhere"`);

    const chained = combinedWorld({ meet_result_titles: [{ meet: MASTERS, title: UNIVERSITY }] });
    await expect(link(chained.ctx, { meet: COMBINED, titles: [MASTERS] })).rejects.toThrow(`"${MASTERS}" has results titles of its own`);

    const linked = combinedWorld();
    await link(linked.ctx, { meet: COMBINED, titles: [MASTERS] });
    await expect(link(linked.ctx, { meet: MASTERS, titles: [UNIVERSITY] })).rejects.toThrow(`"${MASTERS}" is a results title of "${COMBINED}"`);
    expect(await link(linked.ctx, { meet: MASTERS, titles: [] })).toMatchObject({ titles: [] });
    expect(linked.rows('meet_result_titles')).toEqual([expect.objectContaining({ meet: COMBINED, title: MASTERS })]);
  });

  it('keeps a secondary meet completed by hand when the meet sync lists it with dates still ahead', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 11, 16));
    const store = combinedWorld();
    await link(store.ctx, { meet: COMBINED, titles: [MASTERS] });
    expect(await handlerOf(setMeetStatus)(store.ctx, { name: MASTERS, status: 'completed' })).toEqual({ changed: true });
    const sync = handlerOf<{ rows: unknown[] }, unknown[]>(upsertMeets);
    await sync(store.ctx, { rows: [meetRow(MASTERS, { startDate: '2026-12-01', endDate: '2026-12-04' })] });
    await sync(store.ctx, { rows: [meetRow(MASTERS, { startDate: '2026-12-02', endDate: '2026-12-05' })] });
    expect(store.rows('meets').find((meet) => meet.name === MASTERS)).toMatchObject({ status: 'completed', startDate: '2026-12-02' });
  });

  it('lists completed meets with a roster and no results under their name or a linked title until they are linked', async () => {
    const store = fakeMutationCtx({
      meets: [
        { ...meetRow(COMBINED, { status: 'completed' }), updatedAt: 1 },
        { ...meetRow(MASTERS), updatedAt: 1 },
        { ...meetRow('Upcoming With Roster'), updatedAt: 1 },
        { ...meetRow('Completed With Results', { status: 'completed' }), updatedAt: 1 },
        { ...meetRow('Completed Without Roster', { status: 'completed' }), updatedAt: 1 },
        { ...meetRow('Linked To Nothing Yet', { status: 'completed' }), updatedAt: 1 },
      ],
      athletes: [COMBINED, 'Upcoming With Roster', 'Completed With Results', 'Linked To Nothing Yet'].map((meet) => athlete('Ann Master', 'Club A', meet)),
      lifting_results: [result('Ann Master', MASTERS, "Masters Women's 35-39 64kg", 160), result('Ann Master', 'Completed With Results', "Open Women's 64kg", 160)],
      meet_result_titles: [{ meet: 'Linked To Nothing Yet', title: 'Empty Title' }],
    });
    const problems = handlerOf<Record<string, never>, { needsResultsLink: unknown[] }>(meetDataProblems);
    expect((await problems(store.ctx, {})).needsResultsLink).toEqual([
      { name: COMBINED, startDate: '2026-11-20', endDate: '2026-11-23', linkedTitles: [] },
      { name: 'Linked To Nothing Yet', startDate: '2026-11-20', endDate: '2026-11-23', linkedTitles: ['Empty Title'] },
    ]);
    await link(store.ctx, { meet: COMBINED, titles: [MASTERS] });
    expect((await problems(store.ctx, {})).needsResultsLink).toEqual([
      { name: 'Linked To Nothing Yet', startDate: '2026-11-20', endDate: '2026-11-23', linkedTitles: ['Empty Title'] },
    ]);
  });
});
