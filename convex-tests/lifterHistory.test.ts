import { athlete } from '../convex/results';
import { fakeMutationCtx, handlerOf } from './fakeDb';
import { lifterLabel, type AthleteAnswer } from '../convex/lib/lifterHistory';
import { prMarks } from '../convex/lib/prs';
import type { ApiLiftingResult } from '../convex/lib/results';

type Row = Record<string, unknown>;

const apiRow = (extra: Partial<ApiLiftingResult>): ApiLiftingResult => ({
  id: 0,
  event_id: '1',
  federation: 'USAW',
  meet: 'Meet',
  date: '2020-01-01',
  name: 'Taylor Johnson',
  age: "Open Men's 89kg",
  body_weight: 88,
  snatch1: 0,
  snatch2: 0,
  snatch3: 0,
  snatch_best: 0,
  cj1: 0,
  cj2: 0,
  cj3: 0,
  cj_best: 0,
  total: 0,
  adaptive: false,
  ...extra,
});

const lifts = (date: string, snatch: number, cj: number, extra: Partial<ApiLiftingResult> = {}) =>
  apiRow({ date, meet: `Meet ${date}`, snatch1: snatch, snatch_best: snatch, cj1: cj, cj_best: cj, total: snatch + cj, ...extra });

describe('PR marks', () => {
  it('marks each lift that beats every earlier one, the first result setting marks without a PR, and the current best', () => {
    const newestFirst = [lifts('2022-01-01', 100, 120), lifts('2021-01-01', 90, 125), lifts('2020-01-01', 95, 115)];
    expect(prMarks(newestFirst)).toEqual({
      set: { snatch: [0], cj: [1], total: [1, 0] },
      current: { snatch: 0, cj: 1, total: 0 },
    });
  });

  it('keeps the earliest result of a best matched again later as the current best, and matching it is no PR', () => {
    expect(prMarks([lifts('2021-01-01', 100, 120), lifts('2020-01-01', 100, 120)])).toEqual({
      set: { snatch: [], cj: [], total: [] },
      current: { snatch: 1, cj: 1, total: 1 },
    });
  });

  it('passes over a source error, so a typo neither is a PR nor hides the real ones after it', () => {
    const typo = lifts('2021-01-01', 100, 120, { snatch1: 633, snatch2: 63, snatch_best: 633, total: 753 });
    expect(prMarks([lifts('2022-01-01', 105, 125), typo, lifts('2020-01-01', 100, 120)])).toEqual({
      set: { snatch: [0], cj: [0], total: [0] },
      current: { snatch: 0, cj: 0, total: 0 },
    });
  });

  it('orders results of one date by meet, and gives none for a lift never made', () => {
    expect(prMarks([lifts('2020-01-01', 0, 0, { meet: 'B' }), lifts('2020-01-01', 0, 0, { meet: 'A' })])).toEqual({
      set: { snatch: [], cj: [], total: [] },
      current: { snatch: null, cj: null, total: null },
    });
  });
});

describe('a lifter’s label', () => {
  it('gives their age this year, WSO and club, leaving out what is not known', () => {
    expect(lifterLabel({ birthYear: 1989, wso: 'Tennessee-Kentucky', club: 'Iron Club' }, 2026)).toBe('Age 37 · Tennessee-Kentucky · Iron Club');
    expect(lifterLabel({ wso: 'Florida', club: ' ' }, 2026)).toBe('Florida');
    expect(lifterLabel({}, 2026)).toBe('');
  });
});

const result = (extra: Row = {}): Row => ({
  eventId: '100',
  meet: 'Kentucky Open',
  date: '2016-03-19',
  name: 'Taylor Johnson',
  nameKey: 'taylor johnson',
  age: "Open Men's 85 kg",
  total: 163,
  snatchBest: 70,
  cjBest: 93,
  adaptive: false,
  federation: 'USAW',
  ...extra,
});

const lifter = (athleteId: string, extra: Row = {}): Row => ({ athleteId, name: 'Taylor Johnson', nameKey: 'taylor johnson', seenAt: '2020-01-01', ...extra });

const ask = handlerOf<Row, AthleteAnswer>(athlete);

const rowsOf = (answer: AthleteAnswer) => (answer.kind === 'results' ? (JSON.parse(answer.json) as ApiLiftingResult[]).map((row) => [row.meet, row.lifter_id]) : answer.kind);

describe('one athlete’s results', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  const twoLifters = (extra: Row[] = []) =>
    fakeMutationCtx({
      lifters: [lifter('20730', { birthYear: 1989, wso: 'Tennessee-Kentucky' }), lifter('24655', { gender: 'Women', birthYear: 2008, club: 'Barbell Club' })],
      lifter_memberships: [{ membership: '555', athleteId: '24655' }],
      lifter_names: [
        { nameKey: 'taylor johnson', athleteId: '20730' },
        { nameKey: 'taylor johnson', athleteId: '24655' },
        { nameKey: 'taylor smith', athleteId: '24655' },
      ],
      lifting_results: [
        result({ lifterId: '20730', lifterMatch: 'history' }),
        result({ eventId: '200', meet: 'CT Open', date: '2024-08-04', lifterId: '24655', lifterMatch: 'history' }),
        result({ eventId: '300', meet: 'Youth Nationals', date: '2025-06-01', lifterId: '24655', lifterMatch: 'history' }),
        result({ eventId: '400', meet: 'Spring Classic', date: '2019-04-01', name: 'Taylor Smith', nameKey: 'taylor smith', lifterId: '24655', lifterMatch: 'history' }),
        ...extra,
      ],
    });

  it('offers the lifters of a shared name, latest first, with how many results each holds and the results no lifter holds', async () => {
    const { ctx } = twoLifters([result({ eventId: '500', meet: 'Old Meet', date: '2001-01-01' })]);
    const answer = await ask(ctx, { name: 'taylor  JOHNSON' });
    expect(answer).toEqual({
      kind: 'choose',
      name: 'Taylor Johnson',
      lifters: [
        { id: '24655', name: 'Taylor Johnson', label: `Age ${new Date().getUTCFullYear() - 2008} · Barbell Club`, results: 2, latest_date: '2025-06-01' },
        { id: '20730', name: 'Taylor Johnson', label: `Age ${new Date().getUTCFullYear() - 1989} · Tennessee-Kentucky`, results: 1, latest_date: '2016-03-19' },
      ],
      other_results: 1,
    });
  });

  it('answers a lifter’s results under every name they lifted under, with their PR marks and bests since a date', async () => {
    const { ctx } = twoLifters();
    const answer = await ask(ctx, { name: 'Taylor Johnson', lifter: '24655', cutoffDate: '2025-01-01' });
    expect(rowsOf(answer)).toEqual([
      ['Youth Nationals', '24655'],
      ['CT Open', '24655'],
      ['Spring Classic', '24655'],
    ]);
    expect(answer).toMatchObject({
      lifter: { id: '24655', name: 'Taylor Johnson' },
      prs: { set: { snatch: [], cj: [], total: [] }, current: { total: 2 } },
      year_bests: { best_snatch: 70, best_cj: 93, best_total: 163 },
    });
  });

  it('answers the lifter a start list’s membership number names, whatever the name', async () => {
    const { ctx } = twoLifters();
    expect(rowsOf(await ask(ctx, { name: 'Taylor Johnson', membership: '555' }))).toEqual([
      ['Youth Nationals', '24655'],
      ['CT Open', '24655'],
      ['Spring Classic', '24655'],
    ]);
  });

  it('offers the choice for a membership number Sport80 has not named', async () => {
    const { ctx } = twoLifters();
    expect(await ask(ctx, { name: 'Taylor Johnson', membership: '999' })).toMatchObject({ kind: 'choose' });
  });

  it('answers the results no lifter holds when asked for the others', async () => {
    const { ctx } = twoLifters([result({ eventId: '500', meet: 'Old Meet', date: '2001-01-01' })]);
    const answer = await ask(ctx, { name: 'Taylor Johnson', other: true });
    expect(rowsOf(answer)).toEqual([['Old Meet', undefined]]);
    expect(answer).toMatchObject({ lifter: null, year_bests: null });
  });

  it('answers a name’s one lifter directly, and a name no lifter holds any result of as it is', async () => {
    const one = fakeMutationCtx({ lifters: [lifter('20730')], lifting_results: [result({ lifterId: '20730', lifterMatch: 'history' })] });
    expect(await ask(one.ctx, { name: 'Taylor Johnson' })).toMatchObject({ kind: 'results', lifter: { id: '20730' } });
    const none = fakeMutationCtx({ lifting_results: [result()] });
    expect(await ask(none.ctx, { name: 'Taylor Johnson' })).toMatchObject({ kind: 'results', lifter: null });
    expect(rowsOf(await ask(none.ctx, { name: 'Taylor Johnson' }))).toEqual([['Kentucky Open', undefined]]);
  });

  it('refuses an empty name, an empty lifter and a malformed date', async () => {
    const { ctx } = twoLifters();
    await expect(ask(ctx, { name: ' ' })).rejects.toThrow();
    await expect(ask(ctx, { name: 'Taylor Johnson', lifter: '' })).rejects.toThrow();
    await expect(ask(ctx, { name: 'Taylor Johnson', cutoffDate: '2025-13-01' })).rejects.toThrow();
  });
});
