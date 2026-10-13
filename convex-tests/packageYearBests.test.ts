import { packageForMeet } from '../convex/meets';
import { meetKey } from '../convex/lib/viewKeys';
import { textChunks, writeView } from '../convex/lib/views';
import { ANONYMOUS_AUTH, fakeDb, handlerOf } from './fakeDb';

// Premium queries log each caller (`convex/lib/access.ts`).
beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

const STAMP = [{ table: 'lifting_results', version: 1 }];
const STATIC = '{"meet":{"name":"Open"},"schedule":[],"athletes":[{"name":"Ann Lee"}],"meet_results":[]';

/**
 * `meets:packageForMeet` while only a roster athlete's results changed
 * (#216): the static part is still fresh, so it is served as built and only
 * the year bests are computed, without reading the schedule, roster join or
 * meet results again.
 */
describe('packageForMeet with stale year bests only (#216)', () => {
  it('serves the static view and computes the bests alone', async () => {
    const fake = fakeDb({
      athletes: [{ name: 'Ann Lee', meet: 'Open', memberId: '1', age: 30, club: 'C', gender: 'Women', weightClass: '64', entryTotal: 1, adaptive: false }],
      lifting_results: [{ name: 'Ann Lee', nameKey: 'ann lee', meet: 'Spring', date: '2026-03-01', snatchBest: 80, cjBest: 100, total: 180, federation: 'USAW', adaptive: false, eventId: '1' }],
      view_hints: [{ kind: 'athlete', key: 'ann lee', since: '2026-03-01', seq: 0, updatedAt: 1 }],
    });
    const ctx = { db: fake.db, auth: ANONYMOUS_AUTH } as never;
    await writeView(ctx, meetKey('Open', 'package_static'), textChunks(STATIC), STAMP, { text: true });
    await writeView(ctx, meetKey('Open', 'keys'), [JSON.stringify(['ann lee'])], STAMP);
    const tables: string[] = [];
    const query = fake.db.query;
    fake.db.query = ((table: string) => {
      tables.push(table);
      return query(table);
    }) as typeof fake.db.query;

    const answer = (await handlerOf<Record<string, unknown>, { json: string }>(packageForMeet)(ctx, { meet: 'Open', historyCutoffDate: '2025-01-01' })) as { json: string };
    const parsed = JSON.parse(answer.json) as { athletes: unknown[]; year_bests: { name: string }[] };
    expect(answer.json.startsWith(STATIC)).toBe(true);
    expect(parsed.year_bests).toEqual([expect.objectContaining({ name: 'Ann Lee' })]);
    expect(JSON.stringify(parsed.year_bests)).toContain('180');
    expect(tables).not.toContain('session_schedule');
    expect(tables).not.toContain('meets');
  });
});
