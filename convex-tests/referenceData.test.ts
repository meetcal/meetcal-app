import { rosterProblems } from '../convex/lib/roster';
import { computeNationalRankingsForYear, computeRecords, computeWsoList, computeWsoRows, currentWeightClasses } from '../convex/lib/referenceData';

type Row = Record<string, unknown>;

/** Just enough of Convex's `ctx.db` for the reference readers: index equality and ranges, then `collect`. */
function fakeCtx(tables: Record<string, Row[]>) {
  const ctx = {
    db: {
      query: (table: string) => {
        const all = tables[table] ?? [];
        return {
          collect: async () => all,
          withIndex: (_index: string, build: (q: unknown) => unknown) => {
            const filters: ((row: Row) => boolean)[] = [];
            const q = {
              eq: (field: string, value: unknown) => {
                filters.push((row) => row[field] === value);
                return q;
              },
              gte: (field: string, value: string) => {
                filters.push((row) => String(row[field]) >= value);
                return q;
              },
              lte: (field: string, value: string) => {
                filters.push((row) => String(row[field]) <= value);
                return q;
              },
            };
            build(q);
            return { collect: async () => all.filter((row) => filters.every((f) => f(row))) };
          },
        };
      },
    },
  };
  return ctx as never;
}

const lifts = { snatchRecord: 100, cjRecord: 130, totalRecord: 230 };

describe('record holders', () => {
  it('answers each lift holder, with null for what the source left out', async () => {
    const ctx = fakeCtx({
      records: [
        {
          recordType: 'USAW',
          ageCategory: 'Senior',
          gender: 'Women',
          weightClass: '77kg',
          ...lifts,
          snatchBy: { name: 'Ada Lift', date: '2025-06-01', location: 'Nationals, Columbus OH' },
          cjBy: { name: 'Standard' },
        },
      ],
    });

    const [row] = await computeRecords(ctx);

    expect(row.snatch_by).toEqual({ name: 'Ada Lift', date: '2025-06-01', location: 'Nationals, Columbus OH' });
    expect(row.cj_by).toEqual({ name: 'Standard', date: null, location: null });
    expect(row.total_by).toBeNull();
  });

  // A UMWF or USAMW class with one blank lift used to vanish whole, its
  // claimed lifts and their holders with it. The unset lift answers 0, not
  // null: released CLIs read every lift as a number.
  it('answers a class with an unset lift, with 0 for that lift', async () => {
    const ctx = fakeCtx({
      records: [
        {
          recordType: 'UMWF',
          ageCategory: 'Masters 60',
          gender: 'Women',
          weightClass: '58kg',
          snatchRecord: 40,
          snatchBy: { name: 'Ada Lift' },
        },
      ],
    });

    expect(await computeRecords(ctx)).toEqual([
      {
        age_category: 'Masters 60',
        cj_record: 0,
        snatch_record: 40,
        total_record: 0,
        weight_class: '58kg',
        gender: 'Women',
        record_type: 'UMWF',
        snatch_by: { name: 'Ada Lift', date: null, location: null },
        cj_by: null,
        total_by: null,
      },
    ]);
  });

  it('answers WSO record holders the same way', async () => {
    const ctx = fakeCtx({
      wso_records: [
        {
          wso: 'Carolina',
          ageCategory: 'Senior',
          gender: 'Men',
          weightClass: '89kg',
          _creationTime: 1,
          ...lifts,
          totalBy: { name: 'Bo Press', date: '2024-03-02', location: 'Raleigh' },
        },
      ],
    });

    const [row] = await computeWsoRows(ctx, 'Carolina');

    expect(row.total_by).toEqual({ name: 'Bo Press', date: '2024-03-02', location: 'Raleigh' });
    expect(row.snatch_by).toBeNull();
    expect(row.cj_by).toBeNull();
  });
});

describe('WSO records offered', () => {
  const row = (wso: string, weightClass: string) => ({ wso, ageCategory: 'Senior', gender: 'Men', weightClass, _creationTime: 1, snatchRecord: 100 });

  // Michigan's and Wisconsin's rows were loaded once, with retired classes and no holders, and no job updates them.
  it('lists and answers only the WSOs a job keeps current', async () => {
    const ctx = fakeCtx({ wso_records: [row('Carolina', '89'), row('Michigan', '89'), row('Wisconsin', '+109'), row('Georgia', '94')] });
    expect(await computeWsoList(ctx)).toEqual(['Carolina', 'Georgia']);
    expect(await computeWsoRows(ctx, 'Michigan')).toEqual([]);
    expect(await computeWsoRows(ctx, 'Wisconsin')).toEqual([]);
    expect(await computeWsoRows(ctx, 'Georgia')).toHaveLength(1);
  });
});

describe('computeNationalRankingsForYear', () => {
  const result = (name: string, date: string, total: number | undefined, age = "Open Men's 89kg") => ({
    name,
    date,
    total,
    age,
    federation: 'USAW',
  });

  it("keeps each athlete's heaviest total within the year, with its date, heaviest first", async () => {
    const ctx = fakeCtx({
      lifting_results: [
        result('Ada', '2025-12-31', 300),
        result('Ada', '2026-01-01', 250),
        result('Ada', '2026-06-01', 260),
        result('Bo', '2026-12-31', 270),
        result('Bo', '2027-01-01', 400),
        result('Cy', '2026-03-03', 0),
        result('Di', '2026-03-03', undefined),
        result('Ed', '2026-03-03', 500, "Open Men's 96kg"),
      ],
    });

    const rankings = await computeNationalRankingsForYear(ctx, 'USAW', "Open Men's 89kg", '2026');

    expect(rankings).toEqual([
      { name: 'Bo', total: 270, date: '2026-12-31' },
      { name: 'Ada', total: 260, date: '2026-06-01' },
    ]);
  });

  it('leaves out a typo row, ranking the athlete by their real best (#400), and folds spellings (#217)', async () => {
    const lifts = (sn: number[], cj: number[], total: number) => ({
      snatch1: sn[0], snatch2: sn[1], snatch3: sn[2], snatchBest: Math.max(0, ...sn),
      cj1: cj[0], cj2: cj[1], cj3: cj[2], cjBest: Math.max(0, ...cj), total,
    });
    const age = "Men's 14-15 Age Group 79+kg";
    const ctx = fakeCtx({
      lifting_results: [
        // 2026 Texas Barbell Spring Showdown: a `633` typed for `63`.
        { ...result('Gunner Guillory', '2026-04-04', 723, age), ...lifts([-63, 633, 65], [83, 86, 90], 723) },
        { ...result('Gunner Guillory', '2026-05-02', 166, age), ...lifts([65, 68, 71], [88, 92, 95], 166) },
        { ...result('Sidney Porter', '2026-03-01', 253, age), ...lifts([105, 110, -113], [135, 140, 143], 253) },
        { ...result('sidney  porter', '2026-06-01', 250, age), ...lifts([105, 108, -113], [135, 142, -146], 250) },
      ],
    });

    expect(await computeNationalRankingsForYear(ctx, 'USAW', age, '2026')).toEqual([
      { name: 'Sidney Porter', total: 253, date: '2026-03-01' },
      { name: 'Gunner Guillory', total: 166, date: '2026-05-02' },
    ]);
  });
});

describe('weight classes for checking a start list (#388)', () => {
  it('hold every class of both eras of each gender, from the ranking class data', () => {
    const men = currentWeightClasses('Men');
    const women = currentWeightClasses('Women');
    // Since Aug 1, 2026, and before it.
    expect(['75', '85', '95', '110+', '89'].filter((c) => men.has(c))).toEqual(['75', '85', '95', '110+']);
    expect(['79', '88', '94', '65+'].every((c) => men.has(c))).toBe(true);
    expect(['49', '57', '61', '86+', '48', '58', '63', '30'].every((c) => women.has(c))).toBe(true);
  });

  it("let a hand-loaded start list's woman stored as a man be caught", () => {
    const athlete = (gender: string, weightClass: string) => ({ name: 'Lucy Korn', memberId: '1', age: 30, gender, weightClass });
    expect(rosterProblems([athlete('Male', '63')])).toEqual([expect.stringContaining("only the other gender's")]);
    expect(rosterProblems([athlete('Female', '63')])).toEqual([]);
    expect(rosterProblems([athlete('Male', '94')])).toEqual([]);
  });
});
