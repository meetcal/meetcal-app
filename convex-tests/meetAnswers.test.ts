import { editionMedals, needsRoster, type RosterEntry } from '../convex/lib/placings';
import { summarizeEdition } from '../convex/lib/meetSummary';
import { meetNameMatches, meetNameWords, matchingMeetNames } from '../convex/lib/meetNameMatch';
import type { ApiLiftingResult } from '../convex/lib/results';
import { MEET_NAMES_VIEW } from '../convex/lib/viewKeys';
import { jsonChunks, readViewJsonAnyAge, writeView } from '../convex/lib/views';
import * as meetNames from '../convex/meetNames';
import { namesMatching } from '../convex/meets';
import { groupMedals, MEET_ROWS_READ_BUDGET, meetSummaries } from '../convex/results';
import * as views from '../convex/views';
import { getFunctionName } from 'convex/server';
import { ANONYMOUS_AUTH, fakeDb, handlerOf } from './fakeDb';

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

const best = (lifts: readonly number[]) => lifts.reduce((max, lift) => Math.max(max, lift), 0);

function row(name: string, date: string, meet: string, age: string, bodyWeight: number, snatch: [number, number, number], cj: [number, number, number]): ApiLiftingResult {
  const snatchBest = best(snatch);
  const cjBest = best(cj);
  return {
    id: 0,
    event_id: '1',
    federation: 'USAW',
    meet,
    date,
    name,
    age,
    body_weight: bodyWeight,
    snatch1: snatch[0],
    snatch2: snatch[1],
    snatch3: snatch[2],
    snatch_best: snatchBest,
    cj1: cj[0],
    cj2: cj[1],
    cj3: cj[2],
    cj_best: cjBest,
    total: snatchBest > 0 && cjBest > 0 ? snatchBest + cjBest : 0,
    adaptive: false,
  };
}

const result = (name: string, age: string, snatch: number, cj: number, date = '2026-01-01', meet = 'Meet') =>
  row(name, date, meet, age, 70, [snatch, 0, 0], [cj, 0, 0]);

const rostered = (name: string, weightClass: string, gender = 'Women'): RosterEntry => ({ name, weightClass, gender, club: 'Club' });

describe('edition medals (the CLI placing rule on the server)', () => {
  it('ranks within each division and counts only the members’ total medals', () => {
    const rows = [result('Open One', "Open Men's 89kg", 100, 120), result('Open Two', "Open Men's 89kg", 95, 115), result('Youth One', "Youth Men's 61kg", 70, 90)];
    expect(editionMedals(rows, [], ['Open Two', 'Youth One'])).toEqual([{ year: '2026', gold: 1, silver: 1, bronze: 0 }]);
  });

  it('gives a bomb-out no total medal', () => {
    const rows = [
      result('A', "Open Men's 89kg", 150, 0),
      result('B', "Open Men's 89kg", 145, 180),
      result('C', "Open Men's 89kg", 140, 175),
      result('D', "Open Men's 89kg", 135, 170),
    ];
    expect(editionMedals(rows, [], ['A', 'D'])).toEqual([{ year: '2026', gold: 0, silver: 0, bronze: 1 }]);
  });

  it('places classless divisions by roster class and leaves out lifters with no roster entry', () => {
    const rows = [result('Ada', 'Open Women', 80, 100), result('Bea', 'Open Women', 85, 105), result('Cy', 'Open Women', 90, 110)];
    expect(needsRoster(rows)).toBe(true);
    expect(needsRoster([result('Ada', "Open Women's 58 kg", 1, 1), result('Bo', "Open Women's +87KG", 1, 1)])).toBe(false);
    expect(editionMedals(rows, [rostered('Ada', '58'), rostered('Bea', '71')], ['Ada', 'Bea', 'Cy'])).toEqual([{ year: '2026', gold: 2, silver: 0, bronze: 0 }]);
  });

  it('places a lifter once per division with their best total, under any spelling', () => {
    const rows = [
      result('Ada', "Open Women's 64kg", 100, 120),
      result('ada', "Open Women's 64kg", 95, 115),
      result('Bea', "Open Women's 64kg", 90, 115),
      result('Cy', "Open Women's 64kg", 90, 110),
    ];
    expect(editionMedals(rows, [], ['ADA', 'Cy'])).toEqual([{ year: '2026', gold: 1, silver: 0, bronze: 1 }]);
  });

  it('gives source errors no medal and lets the lifters behind them place', () => {
    const typo = row('Typo', '2026-01-01', 'Meet', "Open Men's 89kg", 70, [-63, 633, 65], [0, 0, 0]);
    const rows = [typo, result('Ada', "Open Men's 89kg", 150, 180), result('Bo', "Open Men's 89kg", 140, 175), result('Cy', "Open Men's 89kg", 130, 170)];
    expect(editionMedals(rows, [], ['Cy', 'Typo'])).toEqual([{ year: '2026', gold: 0, silver: 0, bronze: 1 }]);
  });

  it('shares a placing tied on every rule and counts each edition apart, oldest first', () => {
    const rows = [
      result('Ada', "Open Women's 64kg", 80, 100, '2025-05-01'),
      result('Bea', "Open Women's 64kg", 80, 100, '2025-05-01'),
      result('Ada', "Open Women's 64kg", 70, 100, '2024-05-01'),
      result('Bea', "Open Women's 64kg", 80, 100, '2024-05-01'),
      result('Cy', "Open Women's 64kg", 81, 100, '2024-05-01'),
      result('Dee', "Open Women's 64kg", 82, 100, '2024-05-01'),
    ];
    expect(editionMedals(rows, [], ['Ada', 'Bea'])).toEqual([
      { year: '2024', gold: 0, silver: 0, bronze: 1 },
      { year: '2025', gold: 2, silver: 0, bronze: 0 },
    ]);
  });
});

describe('edition summaries (the CLI summary rule on the server)', () => {
  it('counts bomb-outs, makes and the best Sinclair of each gender', () => {
    const summary = summarizeEdition('M', '2026', [
      row('Ada', '2026-01-01', 'M', "Open Women's 64kg", 63, [80, -85, 85], [100, 105, -110]),
      row('Bo', '2026-01-01', 'M', "Open Men's 89kg", 88, [-120, -120, -120], [150, 0, 0]),
    ]);
    expect(summary).toMatchObject({ meet: 'M', year: '2026', athletes: 2, bomb_outs: 1, average_total: 190, make_rate: 50 });
    expect(summary.best_sinclair.women?.name).toBe('Ada');
    expect(summary.best_sinclair.men).toBeNull();
  });

  it('leaves source errors out of the average and the scores, and ranks genders apart', () => {
    const summary = summarizeEdition('M', '2026', [
      row('Hampton', '2026-06-28', 'M', "Open Men's 65kg", 64.5, [140, 0, 0], [175, 0, 0]),
      row('Olivia', '2026-06-28', 'M', "Open Women's 77kg", 76, [115, 0, 0], [145, 0, 0]),
      row('Gunner', '2026-06-28', 'M', "Men's 14-15 Age Group 79+kg", 90.8, [-63, 633, 65], [85, 90, -95]),
    ]);
    expect(summary.average_total).toBe(287.5);
    expect(summary.best_qpoints.men?.name).toBe('Hampton');
    expect(summary.best_qpoints.women?.name).toBe('Olivia');
    expect(summary.best_sinclair.men?.name).toBe('Hampton');
  });

  it('counts a lifter listed in two divisions once', () => {
    const lift = (name: string, division: string, snatch: [number, number, number], date = '2026-03-01') => row(name, date, 'M', division, 70, snatch, [100, -105, 0]);
    const summary = summarizeEdition('M', '2026', [
      lift('Ada Lift', "Open Women's 71kg", [80, 0, 0]),
      lift('Ada  Lift', "Women's Masters (40-44) 71kg", [80, 0, 0]),
      lift('Bea', "Open Women's 71kg", [-70, -70, -70]),
      lift('Bea', "Women's 16-17 Age Group 71kg", [-70, -70, -70]),
      lift('Ada Lift', "Open Women's 71kg", [60, 0, 0]),
      lift('Ada Lift', "Open Women's 71kg", [60, 0, 0], '2026-04-05'),
    ]);
    expect(summary).toMatchObject({ athletes: 4, bomb_outs: 1, average_total: 500 / 3, make_rate: 700 / 14 });
  });

  it('answers null averages and rates for an edition with nothing to count', () => {
    const summary = summarizeEdition('M', '2026', [row('Ada', '2026-01-01', 'M', 'Open', 0, [0, 0, 0], [0, 0, 0])]);
    expect(summary).toMatchObject({ athletes: 1, bomb_outs: 1, average_total: null, make_rate: null });
    expect(summary.best_sinclair).toEqual({ men: null, women: null });
  });
});

const doc = (r: ApiLiftingResult) => ({
  eventId: r.event_id,
  federation: r.federation,
  meet: r.meet,
  date: r.date,
  name: r.name,
  nameKey: r.name.toLowerCase(),
  age: r.age,
  bodyWeight: r.body_weight,
  snatch1: r.snatch1,
  snatch2: r.snatch2,
  snatch3: r.snatch3,
  snatchBest: r.snatch_best,
  cj1: r.cj1,
  cj2: r.cj2,
  cj3: r.cj3,
  cjBest: r.cj_best,
  total: r.total,
  adaptive: r.adaptive,
});

const ask = async <T>(fn: unknown, db: unknown, args: Record<string, unknown>) => await handlerOf<Record<string, unknown>, T>(fn)({ db, auth: ANONYMOUS_AUTH }, args);

describe('results:groupMedals', () => {
  it('reads every spelling given and the linked titles spelled like them, and the roster only when a division needs it', async () => {
    const fake = fakeDb({
      lifting_results: [
        doc(result('Ada', 'Open Women', 80, 100, '2025-04-01', 'Spring Open')),
        doc(result('Bea', 'Open Women', 85, 105, '2025-04-01', 'Spring Open')),
        doc(result('Cy', "Open Women's 71kg", 70, 90, '2024-04-01', 'spring open')),
        doc(result('Dee', "Open Women's 71kg", 90, 120, '2024-04-01', 'SPRING  OPEN')),
        doc(result('Eve', "Open Women's 71kg", 90, 120, '2024-04-01', 'Spring Finals')),
      ],
      meet_result_titles: [
        { meet: 'Spring Open', title: 'SPRING  OPEN' },
        { meet: 'Spring Open', title: 'Spring Finals' },
      ],
      athletes: [
        { meet: 'Spring Open', name: 'Ada', gender: 'Women', weightClass: '58', club: 'Club' },
        { meet: 'Spring Open', name: 'Bea', gender: 'Women', weightClass: '58', club: 'Club' },
      ],
    });
    const medals = await ask(groupMedals, fake.db, { meets: ['Spring Open', 'spring open'], members: ['Ada', 'Cy', 'Eve'] });
    expect(medals).toEqual([
      { year: '2024', gold: 0, silver: 1, bronze: 0 },
      { year: '2025', gold: 0, silver: 1, bronze: 0 },
    ]);
  });

  it('refuses empty, blank or oversized lists', async () => {
    const fake = fakeDb({});
    await expect(ask(groupMedals, fake.db, { meets: [], members: ['Ada'] })).rejects.toMatchObject({ data: { status: 400 } });
    await expect(ask(groupMedals, fake.db, { meets: ['M'], members: [' '] })).rejects.toMatchObject({ data: { status: 400 } });
    await expect(ask(groupMedals, fake.db, { meets: Array.from({ length: 11 }, (_, i) => `M${i}`), members: ['Ada'] })).rejects.toMatchObject({ data: { status: 400 } });
  });

  it('refuses, rather than read without bound, a meet past the read budget', async () => {
    const rows = Array.from({ length: MEET_ROWS_READ_BUDGET + 1 }, (_, i) => doc(result(`Lifter ${i}`, "Open Men's 89kg", 100, 120, '2025-01-01', 'Huge')));
    const fake = fakeDb({ lifting_results: rows });
    await expect(ask(groupMedals, fake.db, { meets: ['Huge'], members: ['Lifter 1'] })).rejects.toMatchObject({ data: { status: 413 } });
  });
});

describe('results:meetSummaries', () => {
  it('summarizes each edition of each meet, with its linked titles, newest first', async () => {
    const fake = fakeDb({
      lifting_results: [
        doc(row('Ada', '2025-03-01', 'Open', "Open Women's 64kg", 63, [80, 0, 0], [100, 0, 0])),
        doc(row('Bo', '2024-03-01', 'Open', "Open Men's 89kg", 88, [120, 0, 0], [150, 0, 0])),
        doc(row('Cy', '2025-03-02', 'Open B', "Open Men's 89kg", 88, [-120, -120, -120], [150, 0, 0])),
        doc(row('Dee', '2023-06-01', 'Other Open', "Open Women's 64kg", 64, [70, 0, 0], [90, 0, 0])),
      ],
      meet_result_titles: [{ meet: 'Open', title: 'Open B' }],
    });
    const summaries = await ask<{ meet: string; year: string; athletes: number; bomb_outs: number }[]>(meetSummaries, fake.db, { meets: ['Other Open', 'Open'] });
    expect(summaries.map(({ meet, year, athletes, bomb_outs }) => [meet, year, athletes, bomb_outs])).toEqual([
      ['Open', '2025', 2, 1],
      ['Open', '2024', 1, 0],
      ['Other Open', '2023', 1, 0],
    ]);
  });

  it('allows at most four meets', async () => {
    await expect(ask(meetSummaries, fakeDb({}).db, { meets: ['A', 'B', 'C', 'D', 'E'] })).rejects.toMatchObject({ data: { status: 400 } });
  });
});

describe('meet names matching words (the CLI attendance rule on the server)', () => {
  it('matches across years, wording, accent forms and case, leaving out excluded words', () => {
    expect(meetNameMatches('2026 Ohio WSO Championships', ['ohio', 'wso'], [])).toBe(true);
    expect(meetNameMatches('The 2023 Ohio WSO Championship', ['ohio', 'wso'], [])).toBe(true);
    expect(meetNameMatches('2026 Ohio Open', ['ohio', 'wso'], [])).toBe(false);
    expect(meetNameMatches('Copa Atlético 2026', ['atlético'], [])).toBe(true);
    expect(meetNameMatches('COPA ATLÉTICO 2026', ['atlético'], [])).toBe(true);
    expect(meetNameMatches('Copa Atlético 2026', ['atletico'], [])).toBe(false);
    const nationals = ['national', 'championships'];
    expect(meetNameMatches('2025 USA Weightlifting National Championships, Powered by Rogue', nationals, ['junior', 'youth'])).toBe(true);
    expect(meetNameMatches('The 2025 National Junior Championships, Powered by Rogue', nationals, ['junior', 'youth'])).toBe(false);
    expect(meetNameWords('The 2026 DMV WSO Championships!')).toBe('dmv wso championships');
  });

  it('answers at most 200 names with the full count', () => {
    const names = Array.from({ length: 250 }, (_, i) => `${2000 + i} Ohio WSO`);
    const answer = matchingMeetNames(names, ['ohio'], []);
    expect(answer.count).toBe(250);
    expect(answer.meets).toHaveLength(200);
  });
});

function harness(seed: Record<string, Record<string, unknown>[]>) {
  const fake = fakeDb(seed);
  const run = async (ref: unknown, args: Record<string, unknown> = {}): Promise<unknown> => {
    const [module = '', name = ''] = getFunctionName(ref as never).split(':');
    const source = (module === 'meetNames' ? meetNames : views) as Record<string, unknown>;
    return await handlerOf<Record<string, unknown>>(source[name])(ctx, args);
  };
  const ctx = { db: fake.db, runQuery: run, runMutation: run, runAction: run };
  return { fake, ctx };
}

describe('meets:namesMatching and the meet name index', () => {
  it('is being built until the index exists, then answers from it', async () => {
    const { fake, ctx } = harness({
      lifting_results: [doc(result('Ada', 'Open', 1, 1, '2025-01-01', '2025 Ohio WSO Championships'))],
      athletes: [{ meet: 'The 2026 Ohio WSO Championships', name: 'Ada', gender: 'Women', weightClass: '58', club: 'Club' }],
    });
    await expect(ask(namesMatching, fake.db, { words: ['ohio', 'wso'] })).rejects.toMatchObject({ data: { status: 503 } });
    await handlerOf(meetNames.buildMeetNames)(ctx, {});
    expect(await ask(namesMatching, fake.db, { words: ['ohio', 'wso'] })).toEqual({
      meets: ['2025 Ohio WSO Championships', 'The 2026 Ohio WSO Championships'],
      count: 2,
    });
    expect(await ask(namesMatching, fake.db, { words: ['ohio'], exclude: ['the'] })).toMatchObject({ count: 2 });
    await expect(ask(namesMatching, fake.db, { words: [] })).rejects.toMatchObject({ data: { status: 400 } });
  });

  it('adds meets that gained rows and removes meets left with none when synced from meet hints', async () => {
    const { fake, ctx } = harness({ lifting_results: [doc(result('Ada', 'Open', 1, 1, '2025-01-01', 'New Meet'))] });
    await writeView(ctx as never, MEET_NAMES_VIEW, jsonChunks(['Gone Meet', 'Kept Meet']), []);
    await meetNames.syncMeetNames(ctx as never, ['New Meet', 'Gone Meet']);
    expect(JSON.parse((await readViewJsonAnyAge(ctx as never, MEET_NAMES_VIEW))!)).toEqual(['Kept Meet', 'New Meet']);
    expect(fake.rows('views')).toHaveLength(1);
  });

  it('builds the whole index when a sync finds none', async () => {
    const { ctx } = harness({ athletes: [{ meet: 'B Meet', name: 'Ada', gender: 'Women', weightClass: '58', club: 'Club' }], lifting_results: [doc(result('Ada', 'Open', 1, 1, '2025-01-01', 'A Meet'))] });
    await meetNames.syncMeetNames(ctx as never, ['A Meet']);
    expect(JSON.parse((await readViewJsonAnyAge(ctx as never, MEET_NAMES_VIEW))!)).toEqual(['A Meet', 'B Meet']);
  });
});
