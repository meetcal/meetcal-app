import { clubKey } from '../convex/lib/clubs';
import { clubAthleteCount, clubAthleteCounts, sameLifterRows } from '../convex/lib/clubStats';
import { ownerOfResult, type LinkedMember } from '../convex/lib/elite';
import { addBests, pruneBests, rank, rankBests, type Candidate, type RankedFields } from '../convex/lib/leaderboard';
import { countedKey, countedLifterOf, countedRowKey, entriesOfLifter, soleLifter, soleLiftersAmong } from '../convex/lib/lifterKeys';
import { soleLifterIds } from '../convex/lib/lifters';
import { bestTotalPerAthlete } from '../convex/lib/referenceData';

function ranked(name: string, total: number, lifter?: string, sole?: string, date = '2026-03-01'): RankedFields {
  return {
    federation: 'USAW',
    meet: 'Open',
    date,
    name,
    age: "Open Men's 89kg",
    body_weight: 88,
    snatch1: 0,
    snatch2: 0,
    snatch3: 0,
    snatch_best: Math.floor(total * 0.45),
    cj1: 0,
    cj2: 0,
    cj3: 0,
    cj_best: total - Math.floor(total * 0.45),
    total,
    adaptive: false,
    ...(lifter === undefined ? {} : { lifter_id: lifter }),
    ...(sole === undefined ? {} : { sole_lifter_id: sole }),
  };
}

describe('the key each result counts under', () => {
  it('is the lifter when linked, the sole lifter it is marked with when not, else the name', () => {
    expect(countedKey('L1', 'john smith')).toBe('lifter:L1');
    expect(countedKey(null, 'john smith')).toBe('name:john smith');
    expect(countedLifterOf({ sole_lifter_id: 'L1' })).toBe('L1');
    expect(countedLifterOf({ lifter_id: 'L2', sole_lifter_id: 'L1' })).toBe('L2');
    expect(countedRowKey({ name: 'John  SMITH' })).toBe('name:john smith');
    expect(countedRowKey({ name: 'John Smith', sole_lifter_id: 'L1' })).toBe('lifter:L1');
  });

  it('names a history’s only lifter, and none for no lifter or several', () => {
    expect(soleLifter([{ lifter_id: 'L1' }, {}, { sole_lifter_id: 'L1' }])).toBe('L1');
    expect(soleLifter([{}, {}])).toBeNull();
    expect(soleLifter([{ lifter_id: 'L1' }, { lifter_id: 'L2' }])).toBeNull();
  });

  it('names each name’s only lifter among the rows at hand', () => {
    const rows = [{ name: 'Ada Lee', lifter_id: 'L1' }, { name: 'ada lee' }, { name: 'Jo Day', lifter_id: 'L2' }, { name: 'Jo Day', lifter_id: 'L3' }, { name: 'Bo' }, { name: 'Cy', sole_lifter_id: 'L4' }];
    expect([...soleLiftersAmong(rows)]).toEqual([['ada lee', 'L1'], ['cy', 'L4']]);
  });
});

describe('the sole lifter an unlinked result is marked with', () => {
  const lifter = { athleteId: 'L1', gender: 'Women', birthYear: 1990 };

  it('is the name’s only linked lifter, when the result’s division fits their gender and age', () => {
    const rows = [
      { age: "Open Women's 71kg", date: '2024-03-01' },
      { age: "Open Women's 71kg", date: '2024-06-01' },
      { age: "Open Men's 89kg", date: '2024-06-01' },
      { age: "Women's Masters (55-59) 71kg", date: '2024-06-01' },
      { age: "Women's 13 Under Age Group 49kg", date: '2024-06-01' },
    ];
    expect(soleLifterIds(rows, ['L1', undefined, undefined, undefined, undefined], [lifter])).toEqual([undefined, 'L1', undefined, undefined, undefined]);
  });

  it('is no one when the name’s rows hold several lifters, or none, or a lifter no longer of the name', () => {
    const rows = [{ age: "Open Women's 71kg", date: '2024-03-01' }, { age: "Open Women's 71kg", date: '2024-04-01' }, { age: "Open Women's 71kg", date: '2024-06-01' }];
    const other = { athleteId: 'L2', gender: 'Women', birthYear: 1991 };
    expect(soleLifterIds(rows, ['L1', 'L2', undefined], [lifter, other])).toEqual([undefined, undefined, undefined]);
    expect(soleLifterIds(rows, [undefined, undefined, undefined], [lifter])).toEqual([undefined, undefined, undefined]);
    expect(soleLifterIds(rows, ['L3', undefined, undefined], [lifter])).toEqual([undefined, undefined, undefined]);
  });
});

describe('the leaderboard by lifter', () => {
  const filters = {};

  it('ranks two lifters of one name apart, each by their own best', () => {
    const rows = [ranked('John Smith', 300, 'L1'), ranked('John Smith', 280, 'L2'), ranked('John Smith', 250, 'L1')];
    expect(rank(rows, 'total', filters, 10).map(({ row, value }) => [row.lifter_id, value])).toEqual([
      ['L1', 300],
      ['L2', 280],
    ]);
  });

  it('counts an unlinked row as the sole lifter it is marked with, keeping the better of the two, and apart when unmarked', () => {
    const rows = [ranked('Ada Lee', 200, 'L1'), ranked('Ada Lee', 210, undefined, 'L1'), ranked('Bo Day', 190)];
    expect(rank(rows, 'total', filters, 10).map(({ row, value }) => [row.name, value])).toEqual([
      ['Ada Lee', 210],
      ['Bo Day', 190],
    ]);
    const unmarked = [ranked('Ada Lee', 200, 'L1'), ranked('Ada Lee', 210), ranked('Bo Day', 190)];
    expect(rank(unmarked, 'total', filters, 10).map(({ value }) => value)).toEqual([210, 200, 190]);
  });

  it('prunes by each athlete’s best, a marked row counting under its sole lifter', () => {
    const rows = [ranked('Ada Lee', 300, 'L1'), ranked('Ada Fox', 290, undefined, 'L1'), ranked('Bo Day', 280, 'L2'), ranked('Cy Fox', 270, 'L3'), ranked('Di Ray', 260, 'L4')];
    const best = new Map<string, Candidate>();
    addBests(best, rows, 'total', filters);
    pruneBests(best, 3);
    expect(rankBests(best.values(), 3).map(({ row }) => row.name)).toEqual(['Ada Lee', 'Bo Day', 'Cy Fox']);
    expect([...best.values()].map(({ row }) => row.name)).not.toContain('Di Ray');
  });
});

describe('the national rankings by lifter', () => {
  it('ranks two lifters of one name apart, and joins a marked unlinked total to its sole lifter', () => {
    const rows = [
      { name: 'John Smith', total: 300, lifter_id: 'L1' },
      { name: 'John Smith', total: 280, lifter_id: 'L2' },
      { name: 'Ada Lee', total: 200, lifter_id: 'L3' },
      { name: 'ada lee', total: 210, sole_lifter_id: 'L3' },
      { name: 'Ada Lee', total: 190 },
    ];
    expect(bestTotalPerAthlete(rows).map(({ name, total }) => [name, total])).toEqual([
      ['John Smith', 300],
      ['John Smith', 280],
      ['ada lee', 210],
      ['Ada Lee', 190],
    ]);
  });
});

describe('WSO elite results by lifter', () => {
  const member = (memberKey: string, lifter: string | null): LinkedMember => ({
    memberKey,
    lifter,
    member: { name: 'John Smith', wso: 'Carolina', gender: 'Men', birthYear: 1990 },
  });

  it('gives a linked result to the member of that lifter, and no one when the lifter is not a member', () => {
    const members = [member('M1', 'L1'), member('M2', 'L2')];
    expect(ownerOfResult(members, { lifter_id: 'L2' }, null, true)?.memberKey).toBe('M2');
    expect(ownerOfResult(members, { lifter_id: 'L9' }, null, true)).toBeNull();
  });

  it('gives an unlinked result to the sole lifter it is marked with, else to a member with no known lifter', () => {
    expect(ownerOfResult([member('M1', 'L1')], { sole_lifter_id: 'L1' }, 'L1', true)?.memberKey).toBe('M1');
    expect(ownerOfResult([member('M1', 'L1')], {}, 'L1', true)).toBeNull();
    expect(ownerOfResult([member('M1', null)], { lifter_id: 'L1' }, 'L1', true)?.memberKey).toBe('M1');
    expect(ownerOfResult([member('M1', 'L1'), member('M2', null)], {}, null, true)?.memberKey).toBe('M2');
    expect(ownerOfResult([member('M1', 'L1')], {}, null, true)).toBeNull();
  });

  it('gives a name’s results to its one member when no lifter holds any of them, and to no one of several namesakes', () => {
    expect(ownerOfResult([member('M1', 'L1')], {}, null, false)?.memberKey).toBe('M1');
    expect(ownerOfResult([member('M1', 'L1'), member('M2', 'L2')], {}, null, false)).toBeNull();
  });
});

describe('meet stats by lifter', () => {
  const lifterOf = (entry: { lifter: string | null }) => entry.lifter;

  it('joins a linked result to its own lifter’s roster entries, else to entries with no known lifter', () => {
    const own = { lifter: 'L1' };
    const other = { lifter: 'L2' };
    const unknown = { lifter: null };
    expect(entriesOfLifter([own, other, unknown], 'L1', 'L1', lifterOf, true)).toEqual([own]);
    expect(entriesOfLifter([other, unknown], 'L1', 'L1', lifterOf, true)).toEqual([unknown]);
    expect(entriesOfLifter([other], 'L1', 'L1', lifterOf, true)).toEqual([]);
  });

  it('joins an unlinked result by name, preferring entries with no known lifter', () => {
    const own = { lifter: 'L1' };
    const unknown = { lifter: null };
    expect(entriesOfLifter([own, unknown], null, null, lifterOf, true)).toEqual([unknown]);
    expect(entriesOfLifter([own], null, null, lifterOf, true)).toEqual([own]);
    expect(entriesOfLifter([own], null, null, lifterOf, false)).toEqual([]);
  });

  it('joins a linked result to an entry with no known lifter only when it is the name’s one lifter there', () => {
    const unknown = { lifter: null };
    expect(entriesOfLifter([unknown, { lifter: null }], 'L1', null, lifterOf, true)).toEqual([]);
    expect(entriesOfLifter([unknown], 'L1', 'L1', lifterOf, true)).toEqual([unknown]);
  });

  it('reads previous results of the whole name only while one lifter holds them', () => {
    const rows = [{ lifterId: 'L1' }, {}, { lifterId: 'L2' }];
    expect(sameLifterRows([{ lifterId: 'L1' }, {}], 'L1')).toHaveLength(2);
    expect(sameLifterRows(rows, 'L1')).toEqual([{ lifterId: 'L1' }]);
    expect(sameLifterRows(rows, null)).toEqual([{}]);
  });

  it('counts a club’s athletes by membership, so two lifters of one name are two and one lifter in two divisions is one', () => {
    const roster = [
      { name: 'John Smith', club: 'Club X', memberId: 'M1' },
      { name: 'John Smith', club: 'Club X', memberId: 'M2' },
      { name: 'Ada Lee', club: 'Club X', memberId: 'M3' },
      { name: 'Ada Lee', club: 'Club X', memberId: 'M3' },
      { name: 'Bo Day', club: 'Club X' },
      { name: 'BO DAY', club: 'Club X' },
    ];
    expect(clubAthleteCount(roster, 'Club X')).toBe(4);
    expect(clubAthleteCounts(roster)).toEqual([[clubKey('Club X'), 4]]);
  });
});
