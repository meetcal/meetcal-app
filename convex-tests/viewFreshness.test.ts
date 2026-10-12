import {
  adaptiveKey,
  athleteChangeAffects,
  earliestSince,
  MEET_INDEX_VIEW,
  meetKey,
  meetSessionKey,
  natKey,
  REF_VIEWS,
  RESULT_NAMES_VIEW,
  viewDependencies,
  wsoKey,
} from '../convex/lib/viewKeys';
import { jsonChunks, readFreshView, readViewAnyAge, writeView } from '../convex/lib/views';
import { recordWrite } from '../convex/ingest';
import { fakeDb } from './fakeDb';

const STAMP = [{ table: 'lifting_results', version: 1 }];

type HintRow = { kind: string; key: string; since?: string };

async function world(hints: HintRow[] = []) {
  const fake = fakeDb({ view_hints: hints.map((h) => ({ ...h, seq: 0, updatedAt: 1 })) });
  const ctx = { db: fake.db } as never;
  const write = (key: string, items: unknown[], meta?: string) => writeView(ctx, key, jsonChunks(items), STAMP, { meta });
  await write(natKey('USAW', 'Open'), [{ name: 'Ada', total: 200 }]);
  await write(natKey('USAW', 'Youth'), [{ name: 'Bo', total: 100 }]);
  await write(meetKey('Spring Open', 'schedule'), []);
  await write(meetKey('Fall Open', 'schedule'), []);
  await write(meetKey('Spring Open', 'keys'), ['ada lovelace', 'bo diddley']);
  await write(meetKey('Spring Open', 'timelines'), [['names', ['Ada Lovelace', 'Bo Diddley']]], '2023-10-12');
  await write(meetKey('Spring Open', 'stats'), [['club_counts', []]], '2026-04-05');
  return { ctx, fake };
}

describe('view dependencies, derived from the key', () => {
  it('name the hints each family is built from', () => {
    expect(viewDependencies(natKey('USAW', "Open Men's 85 kg"))).toEqual({ hints: [{ kind: 'nat', key: JSON.stringify(['USAW', "Open Men's 85 kg"]) }] });
    expect(viewDependencies(meetKey('A|B Open', 'schedule'))).toEqual({ hints: [{ kind: 'meet', key: 'A|B Open' }] });
    expect(viewDependencies(meetSessionKey('Spring Open', 3))).toEqual({ hints: [{ kind: 'meet', key: 'Spring Open' }] });
    expect(viewDependencies(meetKey('Spring Open', 'stats'))).toEqual({
      hints: [{ kind: 'meet', key: 'Spring Open' }],
      roster: { meet: 'Spring Open', part: 'stats' },
    });
    expect(viewDependencies(adaptiveKey('men', 'BWL', '2026'))).toEqual({ hints: [{ kind: 'adaptive', key: '1' }] });
    expect(viewDependencies(wsoKey('California'))).toEqual({ hints: [{ kind: 'table', key: 'wso_records' }] });
    expect(viewDependencies(REF_VIEWS.clubs)).toEqual({ hints: [{ kind: 'table', key: 'athletes' }] });
    expect(viewDependencies(REF_VIEWS.records)).toEqual({ hints: [{ kind: 'table', key: 'records' }] });
  });

  it('name none for the machinery and unknown or retired keys, which are never served as fresh', () => {
    for (const key of [RESULT_NAMES_VIEW, MEET_INDEX_VIEW, 'rebuild|classes', 'result-names', 'meet|Spring Open|roster', 'nat|nofederation']) {
      expect(viewDependencies(key)).toBeNull();
    }
  });

  it('let stats ignore results dated on or after the meet, timelines none', () => {
    expect(athleteChangeAffects('stats', '2026-04-05', '2026-04-05')).toBe(false);
    expect(athleteChangeAffects('stats', '2026-04-04', '2026-04-05')).toBe(true);
    expect(athleteChangeAffects('stats', undefined, '2026-04-05')).toBe(true);
    expect(athleteChangeAffects('stats', '2026-04-04', undefined)).toBe(true);
    expect(athleteChangeAffects('stats', '2020-01-01', '')).toBe(false);
    expect(athleteChangeAffects('timelines', '2099-01-01', '2023-10-12')).toBe(true);
  });

  it('keep the earliest hint date, an unknown one winning', () => {
    expect(earliestSince('2026-01-02', '2025-12-31')).toBe('2025-12-31');
    expect(earliestSince(undefined, '2025-12-31')).toBeUndefined();
    expect(earliestSince('2025-12-31', undefined)).toBeUndefined();
  });
});

describe('readFreshView, per key', () => {
  it('serves every view while nothing is pending', async () => {
    const { ctx } = await world();
    for (const key of [natKey('USAW', 'Open'), meetKey('Spring Open', 'schedule'), meetKey('Spring Open', 'timelines'), meetKey('Spring Open', 'stats')]) {
      expect(await readFreshView(ctx, key)).not.toBeNull();
    }
  });

  it('holds back only the views a pending hint names', async () => {
    const { ctx } = await world([
      { kind: 'nat', key: JSON.stringify(['USAW', 'Open']) },
      { kind: 'meet', key: 'Fall Open' },
    ]);
    expect(await readFreshView(ctx, natKey('USAW', 'Open'))).toBeNull();
    expect(await readFreshView(ctx, natKey('USAW', 'Youth'))).not.toBeNull();
    expect(await readFreshView(ctx, meetKey('Fall Open', 'schedule'))).toBeNull();
    expect(await readFreshView(ctx, meetKey('Spring Open', 'schedule'))).not.toBeNull();
  });

  it('holds back a meet’s timelines and stats for a pending change to an athlete on its roster', async () => {
    const off = await world([{ kind: 'athlete', key: 'someone else', since: '2020-01-01' }]);
    expect(await readFreshView(off.ctx, meetKey('Spring Open', 'timelines'))).not.toBeNull();
    expect(await readFreshView(off.ctx, meetKey('Spring Open', 'stats'))).not.toBeNull();

    const on = await world([{ kind: 'athlete', key: 'ada lovelace', since: '2020-01-01' }]);
    expect(await readFreshView(on.ctx, meetKey('Spring Open', 'timelines'))).toBeNull();
    expect(await readFreshView(on.ctx, meetKey('Spring Open', 'stats'))).toBeNull();
    // The meet's other views do not read athletes' other results.
    expect(await readFreshView(on.ctx, meetKey('Spring Open', 'schedule'))).not.toBeNull();
  });

  it('keeps stats fresh for a result dated after the meet, and not for one of unknown date', async () => {
    const later = await world([{ kind: 'athlete', key: 'ada lovelace', since: '2026-05-01' }]);
    expect(await readFreshView(later.ctx, meetKey('Spring Open', 'stats'))).not.toBeNull();
    expect(await readFreshView(later.ctx, meetKey('Spring Open', 'timelines'))).toBeNull();

    const unknown = await world([{ kind: 'athlete', key: 'ada lovelace' }]);
    expect(await readFreshView(unknown.ctx, meetKey('Spring Open', 'stats'))).toBeNull();
  });

  it('counts roster views stale when more athlete changes are pending than it checks', async () => {
    const hints = Array.from({ length: 201 }, (_, i) => ({ kind: 'athlete', key: `athlete ${String(i).padStart(3, '0')}`, since: '2099-01-01' }));
    const { ctx } = await world(hints);
    expect(await readFreshView(ctx, meetKey('Spring Open', 'timelines'))).toBeNull();
    expect(await readFreshView(ctx, meetKey('Spring Open', 'schedule'))).not.toBeNull();
  });

  it('never serves a header without source stamps, or a machinery view', async () => {
    const { ctx, fake } = await world();
    await fake.db.insert('views', { key: natKey('USAW', 'Old'), etag: 'x', chunk_count: 0, built_at: 0 });
    expect(await readFreshView(ctx, natKey('USAW', 'Old'))).toBeNull();
    await writeView(ctx, RESULT_NAMES_VIEW, ['Ada\n'], [], { text: true });
    expect(await readFreshView(ctx, RESULT_NAMES_VIEW)).toBeNull();
  });

  it('serves the last build whatever its age through readViewAnyAge', async () => {
    const { ctx } = await world([{ kind: 'nat', key: JSON.stringify(['USAW', 'Open']) }]);
    const view = await readViewAnyAge(ctx, natKey('USAW', 'Open'));
    expect(view && JSON.parse(await view.json())).toEqual([{ name: 'Ada', total: 200 }]);
    expect(await readViewAnyAge(ctx, natKey('USAW', 'Never built'))).toBeNull();
  });
});

describe('athlete hints', () => {
  it('keep the earliest result date across writes, until a write of unknown date', async () => {
    const fake = fakeDb();
    const ctx = { db: fake.db, scheduler: { runAfter: jest.fn() } } as never;
    const since = () => fake.rows('view_hints').find((h) => h.kind === 'athlete')?.since;
    await recordWrite(ctx, 'lifting_results', [
      { kind: 'athlete', key: 'ada', since: '2026-03-01' },
      { kind: 'athlete', key: 'ada', since: '2026-02-01' },
    ]);
    expect(since()).toBe('2026-02-01');
    await recordWrite(ctx, 'lifting_results', [{ kind: 'athlete', key: 'ada', since: '2026-05-01' }]);
    expect(since()).toBe('2026-02-01');
    expect(fake.rows('view_hints').find((h) => h.kind === 'athlete')?.seq).toBe(1);
    await recordWrite(ctx, 'lifting_results', [{ kind: 'athlete', key: 'ada' }]);
    expect(since()).toBeUndefined();
  });
});
