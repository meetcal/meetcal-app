import { itemAt } from '../convex/lib/json';
import {
  ageBandOf,
  condenseSightings,
  fitsDivision,
  linkFor,
  mergeSighting,
  sameSourceResult,
  type LifterFacts,
  type Sighting,
  type SourceResult,
} from '../convex/lib/lifters';
import { foldClassLabel, formatAthleteResults, lifterSighting, rankingClasses, rankingClassIds } from '../convex/scrapers/parse/sport80';

const sighting = (extra: Partial<Sighting & { membership: string | null }> = {}): Sighting & { membership: string | null } => ({
  athleteId: '20730',
  membership: '100',
  name: 'Taylor Johnson',
  gender: 'Men',
  birthYear: 1989,
  club: null,
  wso: 'Tennessee-Kentucky',
  date: '2016-03-19',
  ...extra,
});

const row = (extra: Record<string, unknown> = {}) => ({
  date: '2016-03-19',
  meet: 'Second Annual Kentucky State Championship',
  age: "Open Men's 85 kg",
  total: 163,
  snatchBest: 70,
  cjBest: 93,
  federation: 'USAW',
  ...extra,
});

const source = (extra: Partial<SourceResult> = {}): SourceResult => ({
  date: '2016-03-19',
  meet: 'Second Annual Kentucky State Championship',
  age: "Open Men's 85 kg",
  total: 163,
  snatchBest: 70,
  cjBest: 93,
  ...extra,
});

describe('a lifter from their rankings sightings', () => {
  it('takes the name, gender and birth year of the latest sighting', () => {
    const first = mergeSighting(null, sighting({ name: 'Taylor  Johnson', birthYear: 1988, date: '2015-01-01' }));
    const merged = mergeSighting(first, sighting({ date: '2016-03-19' }));
    expect(merged).toMatchObject({ athleteId: '20730', name: 'Taylor Johnson', nameKey: 'taylor johnson', birthYear: 1989, seenAt: '2016-03-19' });
  });

  it('keeps the latest club and WSO that are not blank, whatever order the sightings come in', () => {
    const withClub = sighting({ club: 'Bluegrass Barbell', date: '2016-01-09' });
    const later = sighting({ club: null, wso: null, date: '2016-10-23' });
    for (const order of [
      [withClub, later],
      [later, withClub],
    ]) {
      const merged = order.reduce<ReturnType<typeof mergeSighting> | null>((lifter, s) => mergeSighting(lifter, s), null)!;
      expect(merged).toMatchObject({ club: 'Bluegrass Barbell', clubSeenAt: '2016-01-09', wso: 'Tennessee-Kentucky', wsoSeenAt: '2016-01-09', seenAt: '2016-10-23' });
    }
  });

  it('fills a gender or birth year the latest sighting lacks from an older one', () => {
    const merged = mergeSighting(mergeSighting(null, sighting({ gender: null, birthYear: null, date: '2020-01-01' })), sighting({ date: '2019-01-01' }));
    expect(merged).toMatchObject({ gender: 'Men', birthYear: 1989, seenAt: '2020-01-01' });
  });

  it('condenses many sightings to the few that can change the lifter, without changing what they merge to', () => {
    const many = [
      sighting({ date: '2014-01-01', club: 'Old Club' }),
      sighting({ date: '2015-01-01' }),
      sighting({ date: '2016-01-01', membership: '200' }),
      sighting({ date: '2017-01-01', wso: null, gender: null }),
      sighting({ athleteId: '22081', date: '2016-10-23' }),
    ];
    const condensed = condenseSightings(many);
    expect(condensed.length).toBeLessThan(many.length);
    expect(new Set(condensed.map((s) => s.membership))).toEqual(new Set(['100', '200']));
    const merge = (list: Sighting[], id: string) => list.filter((s) => s.athleteId === id).reduce<ReturnType<typeof mergeSighting> | null>((l, s) => mergeSighting(l, s), null);
    for (const id of ['20730', '22081']) expect(merge(condensed, id)).toEqual(merge(many, id));
  });
});

describe('a stored result and a Sport80 history row', () => {
  it('match on division, total and bests, the date within a week (we store the meet day, Sport80 the lift day)', () => {
    expect(sameSourceResult(row({ date: '2025-06-29' }), source({ date: '2025-06-26' }))).toBe(true);
    expect(sameSourceResult(row({ age: "open men's  85 KG" }), source())).toBe(true);
    expect(sameSourceResult(row({ date: '2025-07-10' }), source({ date: '2025-06-26', meet: 'Another Meet' }))).toBe(false);
    expect(sameSourceResult(row({ total: 164 }), source())).toBe(false);
    expect(sameSourceResult(row({ cjBest: 94 }), source())).toBe(false);
    expect(sameSourceResult(row({ age: "Junior Men's 85 kg" }), source())).toBe(false);
  });

  it('match a month-long online meet across the month when the meet names agree, and only then', () => {
    const qualifier = { meet: '2026 October Online Qualifier (NUQ)' };
    expect(sameSourceResult(row({ ...qualifier, date: '2026-11-01' }), source({ ...qualifier, date: '2026-10-19' }))).toBe(true);
    expect(sameSourceResult(row({ ...qualifier, meet: '2026  october online qualifier (NUQ)', date: '2026-11-01' }), source({ ...qualifier, date: '2026-10-19' }))).toBe(true);
    expect(sameSourceResult(row({ meet: 'Another Meet', date: '2026-11-01' }), source({ ...qualifier, date: '2026-10-19' }))).toBe(false);
    expect(sameSourceResult(row({ ...qualifier, date: '2026-12-31' }), source({ ...qualifier, date: '2026-10-19' }))).toBe(false);
    expect(sameSourceResult(row({ meet: '', date: '2026-11-01' }), source({ meet: '', date: '2026-10-19' }))).toBe(false);
  });

  it('treat a missing lift as zero, as the history answers do', () => {
    expect(sameSourceResult(row({ total: undefined, snatchBest: undefined }), source({ total: 0, snatchBest: 0 }))).toBe(true);
  });
});

describe('whether a result fits a lifter', () => {
  const lifter = (birthYear: number | undefined, gender = 'Men'): LifterFacts => ({ athleteId: '1', gender, birthYear });

  it('reads each division as an age band, the oldest Masters bands open-ended', () => {
    expect(ageBandOf("Men's Masters (55-59) 110kg")).toEqual({ min: 55, max: 59 });
    expect(ageBandOf("Women's Masters (90+) 49kg")).toEqual({ min: 90, max: null });
    expect(ageBandOf("Men's 16-17 Age Group 65kg")).toEqual({ min: null, max: 17 });
    expect(ageBandOf("Junior Women's 77kg")).toEqual({ min: 15, max: 20 });
    expect(ageBandOf("Open Men's 95kg")).toEqual({ min: null, max: null });
    expect(ageBandOf('')).toEqual({ min: null, max: null });
  });

  it('fits an old lifter to an open-ended Masters band', () => {
    expect(fitsDivision({ age: "Men's Masters (90+) 65kg", date: '2026-01-01' }, lifter(1930))).toBe(true);
    expect(fitsDivision({ age: "Men's Masters (75+) 81kg", date: '2014-01-01' }, lifter(1932))).toBe(true);
  });

  it('needs the gender and weightlifting age the division names, give or take a year of the estimate', () => {
    const masters = { age: "Men's Masters (55-59) 110kg", date: '2025-12-07' };
    expect(fitsDivision(masters, lifter(1968))).toBe(true);
    expect(fitsDivision(masters, lifter(1971))).toBe(true);
    expect(fitsDivision(masters, lifter(1972))).toBe(false);
    expect(fitsDivision(masters, lifter(1968, 'Women'))).toBe(false);
    expect(fitsDivision({ age: "Men's 16-17 Age Group 65kg", date: '2025-06-01' }, lifter(1990))).toBe(false);
  });

  it('checks only the gender of a result stored without a date, whose year says nothing about the lifter’s age', () => {
    const undated = { age: "Junior Men's 89kg", date: '1970-01-01' };
    expect(fitsDivision(undated, lifter(1952))).toBe(true);
    expect(fitsDivision(undated, lifter(2005))).toBe(true);
    expect(fitsDivision(undated, lifter(2005, 'Women'))).toBe(false);
    expect(linkFor({ ...row(undated), federation: 'USAW' }, [{ athleteId: 'old', gender: 'Men', birthYear: 1952 }, { athleteId: 'young', gender: 'Men', birthYear: 2005 }], null)).toBeNull();
    expect(linkFor(row({ age: "Men's Masters (55-59) 110kg", date: '1970-01-01', federation: 'USAMW' }), [{ athleteId: 'only', gender: 'Men', birthYear: 1968 }], null)).toEqual({ lifterId: 'only', lifterMatch: 'fit' });
  });

  it('fits a lifter whose birth year is unknown, and any age to an Open division', () => {
    expect(fitsDivision({ age: "Men's Masters (55-59) 110kg", date: '2025-12-07' }, lifter(undefined))).toBe(true);
    expect(fitsDivision({ age: "Open Men's 95kg", date: '2025-12-07' }, lifter(1950))).toBe(true);
  });
});

describe('which lifter a stored result belongs to', () => {
  const kentucky1: LifterFacts = { athleteId: '20730', gender: 'Men', birthYear: 1989 };
  const kentucky2: LifterFacts = { athleteId: '22081', gender: 'Men', birthYear: 1989 };
  const connecticut: LifterFacts = { athleteId: '24655', gender: 'Women', birthYear: 1990 };
  const histories = new Map<string, SourceResult[]>([
    ['20730', [source()]],
    ['22081', [source({ date: '2016-10-23', total: 251, snatchBest: 111, cjBest: 140 })]],
    ['24655', [source({ date: '2019-08-04', age: "Open Women's 71kg", total: 133, snatchBest: 58, cjBest: 75 })]],
  ]);
  const all = [kentucky1, kentucky2, connecticut];

  it('is the one lifter whose Sport80 history holds it', () => {
    expect(linkFor(row(), all, histories)).toEqual({ lifterId: '20730', lifterMatch: 'history' });
    expect(linkFor(row({ date: '2016-10-23', total: 251, snatchBest: 111, cjBest: 140 }), all, histories)).toEqual({ lifterId: '22081', lifterMatch: 'history' });
  });

  it('leaves a USAW result no lifter’s history holds unlinked, even when only one lifter fits it', () => {
    expect(linkFor(row({ date: '2016-05-14', total: 156 }), all, histories)).toBeNull();
    expect(linkFor(row({ date: '2018-11-18', age: "Open Women's 71kg", total: 110 }), all, histories)).toBeNull();
  });

  it('decides between two lifters whose histories both hold a result by which one fits it', () => {
    const both = new Map([...histories, ['22081', [source()]]]);
    expect(linkFor(row(), all, both)).toBeNull();
    const woman = new Map([...histories, ['24655', [source()]]]);
    expect(linkFor(row(), all, woman)).toEqual({ lifterId: '20730', lifterMatch: 'fit' });
  });

  it('places another federation by fit alone, never by a USAW history it could not be in', () => {
    const usamw = { date: '2016-03-19', meet: 'USAMW Nationals', age: "Open Women's +75 Kg", total: 98, snatchBest: 40, cjBest: 58, federation: 'USAMW' };
    expect(linkFor(usamw, all, histories)).toEqual({ lifterId: '24655', lifterMatch: 'fit' });
    expect(linkFor({ ...row(), federation: 'USAMW' }, all, histories)).toBeNull();
  });

  it('links another federation’s result to the one lifter it fits, and sets aside one that fits nobody', () => {
    const only: LifterFacts = { athleteId: '64835', gender: 'Men', birthYear: 2006 };
    expect(linkFor(row({ age: "Junior Men's 94kg", date: '2025-06-29', federation: 'USAMW' }), [only], null)).toEqual({ lifterId: '64835', lifterMatch: 'fit' });
    expect(linkFor(row({ age: "Men's Masters (40-44) 94kg", date: '2025-06-29', federation: 'USAMW' }), [only], null)).toBeNull();
  });

  it('never links a result a Sport80 history could hold without the histories, nor one stored without a federation', () => {
    const only: LifterFacts = { athleteId: '64835', gender: 'Men', birthYear: 2006 };
    expect(linkFor(row({ age: "Junior Men's 94kg", date: '2025-06-29' }), [only], null)).toBeNull();
    expect(linkFor(row({ age: "Junior Men's 94kg", date: '2025-06-29', federation: undefined }), [only], new Map([['64835', []]]))).toBeNull();
  });

  it('is nobody when the name has no lifter', () => {
    expect(linkFor(row(), [], null)).toBeNull();
  });
});

describe('Sport80 rankings parsing', () => {
  const table = {
    filters: [
      { name: 'date_range_start', type: 'datepicker' },
      {
        name: 'weight_class',
        items: [
          { text: "Open Men's 95kg", value: 939 },
          { text: "(Inactive) Open Men's 85 kg", value: 300 },
          { text: "(Inactive) Open Men's 85 kg", value: 301 },
        ],
      },
    ],
  };

  it('lists the weight classes and finds a result division among them however Sport80 spaces or retires it', () => {
    const classes = rankingClasses(table);
    expect(classes.map((c) => c.id)).toEqual([939, 300, 301]);
    expect(rankingClassIds("Open Men's 95kg", classes)).toEqual([939]);
    expect(rankingClassIds("Open Men's 85 kg", classes)).toEqual([300, 301]);
    expect(rankingClassIds("Open Men's 85kg", classes)).toEqual([300, 301]);
    expect(rankingClassIds("Junior Men's 85kg", classes)).toEqual([]);
    expect(foldClassLabel('(Inactive) Open Women’s +75 Kg')).toBe('openwomen’s+75kg');
  });

  it('fails on a weight class it cannot read, rather than leave the class out', () => {
    expect(() => rankingClasses({ filters: [{ name: 'weight_class', items: [{ text: 'x' }] }] })).toThrow('weight class 0');
    expect(() => rankingClasses({ filters: [] })).toThrow('no weight class filter');
  });

  const rankingRow = {
    national_ranking: 1,
    total: 247,
    name: ' Sebastian Stodel ',
    gender: 'M',
    lifter_age: 17,
    club: { type: 'unset' },
    membership: '1076323',
    lift_date: '2025-12-04',
    wso: 'Florida',
    action: [{ type: 'route_button', route: '/public/rankings/member/62652/category/1' }],
  };

  it('reads the athlete id from the row action and the birth year from the age at the lift', () => {
    expect(lifterSighting(rankingRow)).toEqual({
      athleteId: '62652',
      membership: '1076323',
      name: 'Sebastian Stodel',
      gender: 'Men',
      birthYear: 2008,
      club: null,
      wso: 'Florida',
      date: '2025-12-04',
    });
  });

  it('skips a row without an athlete id, name or lift date, and an age that cannot be real', () => {
    expect(lifterSighting({ ...rankingRow, action: [] })).toBeNull();
    expect(lifterSighting({ ...rankingRow, name: { type: 'unset' } })).toBeNull();
    expect(lifterSighting({ ...rankingRow, lift_date: { type: 'unset' } })).toBeNull();
    expect(lifterSighting({ ...rankingRow, lifter_age: 0 })?.birthYear).toBeNull();
    expect(lifterSighting({ ...rankingRow, gender: 'X' })?.gender).toBeNull();
  });

  it('reads an athlete history row by row, each with its own date, as the event tables are read', () => {
    const rows = formatAthleteResults([
      { meet: '2026 Pan American Junior Championships', date: '2026-10-04', age_category: "Junior Men's 65kg", lifter: 'Sebastian Stodel', 'body_weight_(kg)': 64.9, best_snatch: 109, 'best_c&j': 146, total: 255 },
      { meet: 'Undated', date: { type: 'unset' }, age_category: "Junior Men's 65kg", lifter: 'Sebastian Stodel', total: 200 },
      { meet: 'Bad cell', date: '2026-01-01', age_category: "Junior Men's 65kg", lifter: 'Sebastian Stodel', total: 'abc' },
    ]);
    expect(rows[0]).toMatchObject({ date: '2026-10-04', age: "Junior Men's 65kg", total: 255, snatchBest: 109, cjBest: 146, name: 'Sebastian Stodel' });
    expect(itemAt(rows, 1).name).toBeNull();
    expect(itemAt(rows, 2).name).toBeNull();
  });
});
