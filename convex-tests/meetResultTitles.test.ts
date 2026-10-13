import { recordWrite, setMeetResultTitles } from '../convex/ingest';
import { computeStatsRows } from '../convex/lib/meetData';
import { byMeet } from '../convex/results';
import { attendance } from '../convex/meets';
import { fakeMutationCtx, handlerOf } from './fakeDb';

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
const athlete = (name: string, club: string) => ({ memberId: name, name, age: 17, club, gender: 'Women', weightClass: '64', entryTotal: 1, meet: NATIONALS, adaptive: false });

function world() {
  return fakeMutationCtx({
    meets: [{ name: NATIONALS, startDate: '2026-06-18', endDate: '2026-06-28' }, { name: 'Other Meet' }],
    athletes: [athlete('Ann Senior', 'Club A'), athlete('Bo Junior', 'Club A'), athlete('Cy Youth', 'Club B')],
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

  it('refuses a title of another meet, a meet name, the meet itself or an unknown meet, and unlinks with []', async () => {
    const store = world();
    await link(store.ctx, { meet: NATIONALS, titles: [JUNIOR] });
    await expect(link(store.ctx, { meet: 'Other Meet', titles: [JUNIOR] })).rejects.toThrow('already linked');
    await expect(link(store.ctx, { meet: NATIONALS, titles: ['Other Meet'] })).rejects.toThrow('a meet of its own');
    await expect(link(store.ctx, { meet: NATIONALS, titles: [NATIONALS] })).rejects.toThrow("not the meet's own name");
    await expect(link(store.ctx, { meet: 'Nowhere', titles: [JUNIOR] })).rejects.toThrow('no meet named');
    await link(store.ctx, { meet: NATIONALS, titles: [] });
    expect(store.rows('meet_result_titles')).toEqual([]);
    const rows = JSON.parse((await handlerOf<{ meet: string }, { json: string }>(byMeet)(store.ctx, { meet: NATIONALS })).json) as unknown[];
    expect(rows).toHaveLength(1);
  });
});
