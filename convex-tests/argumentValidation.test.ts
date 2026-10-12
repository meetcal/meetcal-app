import { ConvexError } from 'convex/values';
import { AGE_GROUPS } from '../src/constants/nat-rankings';
import { getWeightClasses } from '../src/utils/nat-rankings';
import { list as listMeets, packageForMeet, upcomingWindowNow } from '../convex/meets';
import { adaptiveRecords, nationalRankings, nationalRankingsByYear } from '../convex/reference';
import { isRankingDivision, requireAdaptiveGender, requireKnownRankingClass } from '../convex/lib/referenceData';
import { requireSavedSessionWhen } from '../convex/users';

type Row = Record<string, unknown>;

/** A registered function's handler (`_handler` is how Convex keeps it). */
function handlerOf(fn: unknown): (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> {
  return (fn as { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> })._handler;
}

/** `ctx.db` over `tables`: index equality and `first()` only. Counts reads. */
function fakeCtx(tables: Record<string, Row[]> = {}) {
  const reads = { count: 0 };
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (_index: string, build: (q: unknown) => unknown) => {
          const filters: ((row: Row) => boolean)[] = [];
          const q = {
            eq: (field: string, value: unknown) => {
              filters.push((row) => row[field] === value);
              return q;
            },
          };
          build(q);
          return {
            first: async () => {
              reads.count += 1;
              return (tables[table] ?? []).find((row) => filters.every((f) => f(row))) ?? null;
            },
          };
        },
      }),
    },
  };
  return { ctx: ctx as never, reads };
}

/** A ctx whose database must not be touched: validation comes first. */
const NO_DB = {
  db: new Proxy({}, { get: () => () => { throw new Error('read before validating'); } }),
} as never;

async function statusOf(promise: Promise<unknown> | (() => unknown)): Promise<number | 'ok'> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
    return 'ok';
  } catch (error) {
    if (error instanceof ConvexError) return (error.data as { status: number }).status;
    throw error;
  }
}

describe('reference:adaptiveRecords gender', () => {
  it.each(['men', 'Men', 'WOMEN', 'women'])('accepts %p', (gender) => {
    expect(requireAdaptiveGender(gender)).toBe(gender.toLowerCase());
  });

  it.each(['male', 'M', 'F', '', ' men'])('rejects %p with a 400 instead of answering women', async (gender) => {
    expect(await statusOf(() => requireAdaptiveGender(gender))).toBe(400);
    expect(await statusOf(handlerOf(adaptiveRecords)(NO_DB, { gender, excludeFederation: 'BWL' }))).toBe(400);
  });
});

describe('meets:packageForMeet year bests', () => {
  it('needs historyCutoffDate when year_bests is asked for, explicitly or by default', async () => {
    const handler = handlerOf(packageForMeet);
    expect(await statusOf(handler(NO_DB, { meet: 'Open' }))).toBe(400);
    expect(await statusOf(handler(NO_DB, { meet: 'Open', include: ['year_bests'] }))).toBe(400);
  });
});

describe('national ranking classes', () => {
  it('know every division the app (and so the website) offers', () => {
    for (const gender of ['Men', 'Women'] as const) {
      for (const ageGroup of AGE_GROUPS) {
        for (const division of getWeightClasses(gender, ageGroup)) expect([division, isRankingDivision(division)]).toEqual([division, true]);
      }
    }
  });

  it.each(["open men's 60kg", "Open Mens 60kg", "Open Men's 60", "Men's Masters (36-40) 79kg", "Open Men's 60kg "])(
    'do not take %p for a division',
    (ageCategory) => {
      expect(isRankingDivision(ageCategory)).toBe(false);
    },
  );

  const tables = {
    lifting_results: [
      { federation: 'USAW', age: "Open Men's 85 kg" },
      { federation: 'USAMW', age: "Men's Masters (35-39) 79kg" },
    ],
  };

  it('accept a current division nobody has lifted in yet, with one read', async () => {
    const { ctx, reads } = fakeCtx(tables);
    expect(await statusOf(requireKnownRankingClass(ctx, 'USAW', "Women's Masters (90+) 86+kg"))).toBe('ok');
    expect(reads.count).toBe(1);
  });

  it('accept a retired class that has results', async () => {
    expect(await statusOf(requireKnownRankingClass(fakeCtx(tables).ctx, 'USAW', "Open Men's 85 kg"))).toBe('ok');
  });

  it('answer 404 for an unknown federation or a misspelled class', async () => {
    expect(await statusOf(requireKnownRankingClass(fakeCtx(tables).ctx, 'usaw', "Open Men's 60kg"))).toBe(404);
    expect(await statusOf(requireKnownRankingClass(fakeCtx(tables).ctx, 'USAW', "open men's 60kg"))).toBe(404);
    expect(await statusOf(handlerOf(nationalRankings)(fakeCtx(tables).ctx, { federation: 'USAW', ageCategory: 'Open Men 60' }))).toBe(404);
    expect(
      await statusOf(
        handlerOf(nationalRankingsByYear)(fakeCtx(tables).ctx, { federation: 'BWL', ageCategory: "Open Men's 60kg", year: '2026' }),
      ),
    ).toBe(404);
  });
});

describe('users:putSavedSession session timing', () => {
  it.each<[number, string | undefined, string | undefined]>([
    [1, '2026-06-20', '9:00 AM'],
    [12, '2026-06-20', '09:00:00'],
    [3, '2026-06-20', '9:00AM'],
    [3, '2026-06-20', '12:30:00 pm'],
    [3, '', ''],
    [3, undefined, undefined],
  ])('accepts session %p on %p at %p', async (session, date, startTime) => {
    expect(await statusOf(() => requireSavedSessionWhen(session, date, startTime))).toBe('ok');
  });

  it.each<[number, string | undefined, string | undefined]>([
    [0, '2026-06-20', '9:00 AM'],
    [-1, '2026-06-20', '9:00 AM'],
    [1.5, '2026-06-20', '9:00 AM'],
    [1, '06/20/2026', '9:00 AM'],
    [1, '2026-02-30', '9:00 AM'],
    [1, '2026-06-20', 'soon'],
    [1, '2026-06-20', '13:00 PM'],
    [1, '2026-06-20', '24:00'],
  ])('rejects session %p on %p at %p with a 400', async (session, date, startTime) => {
    expect(await statusOf(() => requireSavedSessionWhen(session, date, startTime))).toBe(400);
  });
});

describe('meets:list now', () => {
  const HOUR = 60 * 60 * 1000;
  const serverNow = Date.UTC(2026, 9, 12, 11, 12, 13);
  const serverHour = Date.UTC(2026, 9, 12, 11);

  it('takes the whole hour every client sends', () => {
    expect(upcomingWindowNow(serverHour, serverNow)).toBe(serverHour);
    expect(upcomingWindowNow(serverHour - 23 * HOUR, serverNow)).toBe(serverHour - 23 * HOUR);
  });

  it("gives way to the server's hour for a clock more than a day off", () => {
    expect(upcomingWindowNow(serverHour - 90 * 24 * HOUR, serverNow)).toBe(serverHour);
  });

  it.each([serverNow, serverHour + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %p before reading anything, so varying it cannot bust the cache',
    async (now) => {
      expect(await statusOf(() => upcomingWindowNow(now, serverNow))).toBe(400);
      expect(await statusOf(handlerOf(listMeets)(NO_DB, { now }))).toBe(400);
    },
  );
});
