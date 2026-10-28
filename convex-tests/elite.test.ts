import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import { passes } from '../convex/accessPass';
import { setPremiumModeForTests } from '../convex/lib/access';
import {
  AGE_FACTORS_MEN,
  AGE_FACTORS_WOMEN,
  ageFactor,
  checkEliteArgs,
  classLimit,
  type EliteMember,
  groupOfAge,
  latestRegistration,
  type MemberResult,
  qmasters,
  rankList,
  registrationGender,
  scoreResult,
  standardFor,
  standardTables,
} from '../convex/lib/elite';
import { qpoints, type RankedFields, sinclair } from '../convex/lib/leaderboard';
import { eliteMembers, eliteRegistrations, eliteResults, eliteStandards, wsoElite } from '../convex/results';
import type { EliteAnswer } from '../convex/lib/elite';
import { fakeDb, handlerOf } from './fakeDb';

/** A USAW result with a made snatch and clean & jerk, its total their sum. */
function result(date: string, division: string, bw: number, snatch: number, cj: number, extra: Partial<RankedFields> = {}): RankedFields {
  return {
    federation: 'USAW',
    meet: `Meet ${date}`,
    date,
    name: 'Ada',
    age: division,
    body_weight: bw,
    snatch1: snatch,
    snatch2: 0,
    snatch3: 0,
    snatch_best: snatch,
    cj1: cj,
    cj2: 0,
    cj3: 0,
    cj_best: cj,
    total: snatch + cj,
    adaptive: false,
    ...extra,
  };
}

const member = (birthYear: number | null, gender: EliteMember['gender'] = 'Women', name = 'Ada'): EliteMember => ({ name, wso: 'Carolina', gender, birthYear });

const STANDARDS = standardTables([
  { ageCategory: 'Senior', gender: 'Women', weightClass: '63kg', standardA: 200 },
  { ageCategory: 'Senior', gender: 'Women', weightClass: '+86kg', standardA: 240 },
  { ageCategory: 'Senior', gender: 'Women', weightClass: '86kg', standardA: 230 },
  { ageCategory: 'Junior', gender: 'Women', weightClass: '63kg', standardA: 180 },
  { ageCategory: 'Youth', gender: 'Women', weightClass: '63kg', standardA: 150 },
  { ageCategory: 'U15', gender: 'Women', weightClass: '63kg', standardA: 120 },
  { ageCategory: 'Senior', gender: 'Men', weightClass: '88kg', standardA: 320 },
]);

describe('age groups', () => {
  it('splits weightlifting ages into Youth to 17, Junior 18–20, Senior 21–34 and Masters from 35', () => {
    expect([13, 17, 18, 20, 21, 34, 35, 70].map(groupOfAge)).toEqual(['youth', 'youth', 'junior', 'junior', 'senior', 'senior', 'masters', 'masters']);
    expect([0, 4, 101, 17.5].map(groupOfAge)).toEqual([null, null, null, null]);
  });
});

describe('Q-masters', () => {
  it('multiplies Q-points by the 2025 age factor, women and men apart', () => {
    expect(AGE_FACTORS_WOMEN).toHaveLength(61);
    expect(AGE_FACTORS_MEN).toHaveLength(66);
    expect([ageFactor(29, 'Women'), ageFactor(30, 'Women'), ageFactor(45, 'Women'), ageFactor(90, 'Women'), ageFactor(95, 'Women')]).toEqual([1, 1, 1.194, 3.935, 3.935]);
    expect([ageFactor(45, 'Men'), ageFactor(95, 'Men'), ageFactor(99, 'Men')]).toEqual([1.173, 4.863, 4.863]);
    expect(qmasters(150, 70, 'Women', 45)).toBeCloseTo(qpoints(150, 70, 'Women')! * 1.194, 10);
    expect(qmasters(0, 70, 'Women', 45)).toBeNull();
  });
});

describe('A standards', () => {
  it('reads class limits, open classes either way round', () => {
    expect(['63kg', '+86kg', '86+kg', '58.5kg', 'abc'].map(classLimit)).toEqual([
      { limit: 63, open: false },
      { limit: 86, open: true },
      { limit: 86, open: true },
      { limit: 58.5, open: false },
      null,
    ]);
  });

  it('holds a bodyweight to the lightest class it is within, else the open class; Masters to Senior', () => {
    expect(standardFor(STANDARDS, 'senior', 'Women', 62.4)).toEqual({ weightClass: '63kg', standardA: 200 });
    expect(standardFor(STANDARDS, 'senior', 'Women', 70)).toEqual({ weightClass: '86kg', standardA: 230 });
    expect(standardFor(STANDARDS, 'senior', 'Women', 99)).toEqual({ weightClass: '+86kg', standardA: 240 });
    expect(standardFor(STANDARDS, 'masters', 'Women', 62)).toEqual({ weightClass: '63kg', standardA: 200 });
    expect(standardFor(STANDARDS, 'youth', 'Women', 62)).toEqual({ weightClass: '63kg', standardA: 150 });
    // No open class in the Junior table: a heavier junior has no standard.
    expect(standardFor(STANDARDS, 'junior', 'Women', 70)).toBeNull();
    expect(standardFor(STANDARDS, 'junior', 'Men', 70)).toBeNull();
  });
});

describe('members', () => {
  it('belong to the WSO of their latest registration, by meet date, then by write order', () => {
    const reg = (wso: string, meetDate: string, created: number, age = 30, meet = 'Open') => ({ name: 'Ada', wso, gender: 'Women', age, meet, meetDate, created });
    expect(latestRegistration([reg('Carolina', '2025-06-01', 1), reg('Florida', '2026-03-01', 0, 31)])).toEqual({ name: 'Ada', wso: 'Florida', gender: 'Women', birthYear: 1995 });
    expect(latestRegistration([reg('Carolina', '2026-03-01', 2), reg('Florida', '2026-03-01', 1)])?.wso).toBe('Carolina');
    expect(latestRegistration([reg('Carolina', '', 5), reg('Florida', '2020-01-01', 1)])?.wso).toBe('Florida');
    expect(latestRegistration([reg('Carolina', '', 1)])?.birthYear).toBeNull();
    // A meet that is not stored still dates the registration by the year in its name.
    expect(latestRegistration([reg('Carolina', '', 1, 40, '2026 USA Weightlifting National Championships')])?.birthYear).toBe(1986);
    expect(latestRegistration([reg('Carolina', '2025-06-01', 1, 0)])?.birthYear).toBeNull();
    expect(latestRegistration([])).toBeNull();
  });

  it('read a registration’s gender', () => {
    expect(['Women', 'female', ' F ', 'Men', 'm', 'X', ''].map(registrationGender)).toEqual(['Women', 'Women', 'Women', 'Men', 'Men', null, null]);
  });
});

describe('scores', () => {
  const at = (row: RankedFields, birthYear = 2000, gender: EliteMember['gender'] = 'Women'): MemberResult => ({ row, member: member(birthYear, gender) });

  it('score % of A against the group’s standard and record which', () => {
    const scored = scoreResult(at(result('2026-04-01', "Open Women's 63kg", 62, 90, 110)), 'senior', 'percentA', STANDARDS);
    expect(scored).toMatchObject({ group: 'senior', age: 26, score: 100, weight_class: '63kg', standard_a: 200, gender: 'Women' });
  });

  it('leave a result out of the other groups’ lists, but not Overall', () => {
    const row = at(result('2026-04-01', "Junior Women's 63kg", 62, 81, 99), 2007);
    expect(scoreResult(row, 'senior', 'percentA', STANDARDS)).toBeNull();
    expect(scoreResult(row, 'junior', 'percentA', STANDARDS)?.score).toBe(100);
    expect(scoreResult(row, 'overall', 'percentA', STANDARDS)?.group).toBe('junior');
  });

  it('give Youth no Q score, and Masters Q-masters under Overall’s Q-points', () => {
    const youth = at(result('2026-04-01', "Youth Women's 63kg", 62, 60, 75), 2010);
    expect(scoreResult(youth, 'overall', 'qpoints', STANDARDS)).toBeNull();
    expect(scoreResult(youth, 'youth', 'sinclair', STANDARDS)?.score).toBe(sinclair(135, 62, 'Women'));
    const master = at(result('2026-04-01', "Women's Masters (45-49) 63kg", 62, 60, 75), 1981);
    expect(scoreResult(master, 'overall', 'qpoints', STANDARDS)?.score).toBe(qmasters(135, 62, 'Women', 45));
    expect(scoreResult(master, 'masters', 'qmasters', STANDARDS)?.score).toBe(qmasters(135, 62, 'Women', 45));
    expect(scoreResult(master, 'masters', 'percentA', STANDARDS)?.score).toBe(67.5);
  });

  it('skip non-USAW results, source errors, missing totals, unknown ages and genders', () => {
    const division = "Open Women's 63kg";
    expect(scoreResult(at(result('2026-04-01', division, 62, 90, 110, { federation: 'USAMW' })), 'senior', 'sinclair', STANDARDS)).toBeNull();
    expect(scoreResult(at(result('2026-04-01', division, 62, 90, 110, { total: 150 })), 'senior', 'sinclair', STANDARDS)).toBeNull();
    expect(scoreResult(at(result('2026-04-01', division, 62, 90, 0, { total: 0 })), 'senior', 'sinclair', STANDARDS)).toBeNull();
    expect(scoreResult({ row: result('2026-04-01', division, 62, 90, 110), member: member(null) }, 'senior', 'sinclair', STANDARDS)).toBeNull();
    expect(scoreResult(at(result('2026-04-01', 'Open 63kg', 62, 90, 110), 2000, null), 'senior', 'sinclair', STANDARDS)).toBeNull();
    // A division without a gender falls back to the registration's.
    expect(scoreResult(at(result('2026-04-01', 'Open 63kg', 62, 90, 110), 2000, 'Women'), 'senior', 'sinclair', STANDARDS)?.gender).toBe('Women');
    // Adaptive results count.
    expect(scoreResult(at(result('2026-04-01', division, 62, 90, 110, { adaptive: true })), 'senior', 'percentA', STANDARDS)?.score).toBe(100);
  });
});

describe('a list', () => {
  const entry = (memberKey: string, name: string, row: RankedFields, birthYear = 2000, gender: EliteMember['gender'] = 'Women') => ({
    memberKey,
    row,
    member: member(birthYear, gender, name),
  });

  it('holds each member once by their best, best first, men and women apart, ties to the earlier result', () => {
    const answer = rankList(
      [
        entry('1', 'Ada', result('2026-01-01', "Open Women's 63kg", 62, 80, 100)),
        entry('1', 'Ada', result('2026-05-01', "Open Women's 63kg", 62, 90, 110)),
        entry('2', 'Bea', result('2026-03-01', "Open Women's 63kg", 62, 90, 110)),
        entry('3', 'Cy', result('2026-02-01', "Open Women's 63kg", 62, 85, 105)),
        entry('4', 'Bo', result('2026-02-01', "Open Men's 88kg", 87, 140, 180), 2000, 'Men'),
      ],
      'senior',
      'percentA',
      STANDARDS,
    );
    expect(answer.method).toBe('percentA');
    expect(answer.women.map((row) => [row.name, row.date, row.score])).toEqual([
      ['Bea', '2026-03-01', 100],
      ['Ada', '2026-05-01', 100],
      ['Cy', '2026-02-01', 95],
    ]);
    expect(answer.men.map((row) => [row.name, row.score])).toEqual([['Bo', 100]]);
  });

  it('keeps at most the list size per gender', () => {
    const many = Array.from({ length: 25 }, (_, i) => entry(String(i), `Lifter ${i}`, result('2026-01-01', "Open Women's 63kg", 62, 60 + i, 80)));
    const answer = rankList(many, 'senior', 'sinclair', STANDARDS);
    expect(answer.women).toHaveLength(20);
    expect(answer.women[0].name).toBe('Lifter 24');
  });
});

describe('the arguments', () => {
  const base = { wso: ' Carolina ', from: '2025-01-01', to: '2025-12-31' };

  it('default each list’s method: % of A, and Q-masters for Masters', () => {
    expect(checkEliteArgs(base)).toEqual({
      wso: 'Carolina',
      from: '2025-01-01',
      to: '2025-12-31',
      methods: { overall: 'percentA', youth: 'percentA', junior: 'percentA', senior: 'percentA', masters: 'qmasters' },
    });
    expect(checkEliteArgs({ ...base, methods: { masters: 'sinclair', overall: 'qpoints' } }).methods).toMatchObject({ masters: 'sinclair', overall: 'qpoints' });
  });

  it('refuse a blank WSO, a bad range, and a method a list does not offer', () => {
    const status = (args: Parameters<typeof checkEliteArgs>[0]) => {
      try {
        checkEliteArgs(args);
        return 'ok';
      } catch (error) {
        return error instanceof ConvexError ? (error.data as { status: number; error: string }).error : error;
      }
    };
    expect(status({ ...base, wso: ' ' })).toBe('wso is required');
    expect(status({ ...base, from: '2025-13-01' })).toMatch(/from must be/);
    expect(status({ ...base, to: '2024-12-31' })).toMatch(/not be before/);
    expect(status({ ...base, to: '2030-01-01' })).toMatch(/at most 5 years/);
    expect(status({ ...base, methods: { youth: 'qpoints' } })).toBe('youth can be scored by percentA, sinclair, not "qpoints"');
    expect(status({ ...base, methods: { senior: 'qmasters' } })).toMatch(/senior can be scored by/);
  });
});

describe('results:wsoElite', () => {
  const NOW = Date.UTC(2026, 9, 13);
  const PASSES = [{ current: 'today', previous: null, rotatedAt: NOW }];
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    setPremiumModeForTests(null);
    log.mockRestore();
  });

  const registration = (memberId: string, name: string, wso: string, meet: string, age: number, gender = 'Women') => ({
    memberId,
    name,
    age,
    club: 'Club',
    wso,
    gender,
    weightClass: '63',
    entryTotal: 0,
    meet,
    adaptive: false,
  });
  const meet = (name: string, startDate: string) => ({
    name,
    venueName: '',
    venueStreet: '',
    venueCity: '',
    venueState: '',
    venueZip: '',
    timeZone: 'America/New_York',
    startDate,
    endDate: startDate,
    status: 'completed',
    updatedAt: 0,
  });
  const stored = (name: string, date: string, division: string, bw: number, snatch: number, cj: number, federation = 'USAW') => ({
    eventId: 'e1',
    meet: `Meet ${date}`,
    date,
    name,
    nameKey: name.toLowerCase(),
    age: division,
    bodyWeight: bw,
    snatch1: snatch,
    snatchBest: snatch,
    cj1: cj,
    cjBest: cj,
    total: snatch + cj,
    adaptive: false,
    federation,
  });

  function actionCtx() {
    const { db } = fakeDb({
      access_passes: PASSES,
      meets: [meet('Nationals 2025', '2025-06-01'), meet('Open 2026', '2026-02-01')],
      athletes: [
        registration('1', 'Ada', 'Carolina', 'Nationals 2025', 25),
        registration('2', 'Bea', 'Carolina', 'Nationals 2025', 46),
        // Cy moved to Florida at their latest meet.
        registration('3', 'Cy', 'Carolina', 'Nationals 2025', 30),
        registration('3', 'Cy', 'Florida', 'Open 2026', 31),
        registration('4', 'Bo', 'Carolina', 'Nationals 2025', 19, 'Men'),
      ],
      standards: [
        { ageCategory: 'Senior', gender: 'Women', weightClass: '63kg', standardA: 200, standardB: 180 },
        { ageCategory: 'Junior', gender: 'Men', weightClass: '88kg', standardA: 300, standardB: 280 },
      ],
      lifting_results: [
        stored('Ada', '2025-03-01', "Open Women's 63kg", 62, 90, 110),
        stored('Ada', '2025-09-01', "Open Women's 63kg", 62, 80, 100),
        stored('Ada', '2024-12-31', "Open Women's 63kg", 62, 100, 130),
        stored('Bea', '2025-04-01', "Women's Masters (45-49) 63kg", 62, 60, 80),
        stored('Bea', '2025-05-01', "Women's Masters (45-49) 63kg", 62, 99, 99, 'USAMW'),
        stored('Cy', '2025-04-01', "Open Women's 63kg", 62, 100, 120),
        stored('Bo', '2025-04-01', "Junior Men's 88kg", 87, 130, 170),
      ],
    });
    const handlers: Record<string, unknown> = {
      'accessPass:passes': passes,
      'results:eliteRegistrations': eliteRegistrations,
      'results:eliteMembers': eliteMembers,
      'results:eliteResults': eliteResults,
      'results:eliteStandards': eliteStandards,
    };
    const runQuery = jest.fn(async (ref: unknown, args: unknown) => handlerOf(handlers[getFunctionName(ref as never)])({ db }, args));
    return { runQuery };
  }

  const run = (ctx: unknown, args: Record<string, unknown>) =>
    handlerOf<Record<string, unknown>, EliteAnswer>(wsoElite)(ctx, { wso: 'Carolina', from: '2025-01-01', to: '2025-12-31', pass: 'today', ...args });

  it('ranks the members whose latest registration is the WSO, each list by its method', async () => {
    const answer = await run(actionCtx(), {});
    expect(answer.members).toBe(3);
    expect(answer.lists.overall.method).toBe('percentA');
    expect(answer.lists.overall.women.map((row) => [row.name, row.score])).toEqual([
      ['Ada', 100],
      ['Bea', 70],
    ]);
    expect(answer.lists.overall.men.map((row) => [row.name, row.score])).toEqual([['Bo', 100]]);
    expect(answer.lists.senior.women.map((row) => row.name)).toEqual(['Ada']);
    expect(answer.lists.junior.men.map((row) => row.name)).toEqual(['Bo']);
    expect(answer.lists.masters.method).toBe('qmasters');
    expect(answer.lists.masters.women).toEqual([expect.objectContaining({ name: 'Bea', age: 46, score: qmasters(140, 62, 'Women', 46) })]);
    expect(answer.lists.youth).toEqual({ method: 'percentA', men: [], women: [] });
  });

  it('scores each list by the method asked for', async () => {
    const answer = await run(actionCtx(), { methods: { masters: 'percentA', overall: 'sinclair' } });
    expect(answer.lists.masters.women[0].score).toBe(70);
    expect(answer.lists.overall.women[0].score).toBe(sinclair(200, 62, 'Women'));
  });

  it('refuses a read without a current pass before reading anything else, and an unknown WSO', async () => {
    const ctx = actionCtx();
    const status = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return 'ok';
      } catch (error) {
        if (error instanceof ConvexError) return (error.data as { status: number }).status;
        throw error;
      }
    };
    expect(await status(run(ctx, { pass: undefined }))).toBe(401);
    expect(ctx.runQuery.mock.calls.map(([ref]) => getFunctionName(ref as never))).toEqual(['accessPass:passes']);
    expect(await status(run(ctx, { wso: 'Nowhere' }))).toBe(404);
  });
});
