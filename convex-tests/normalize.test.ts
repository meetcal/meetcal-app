import { directoryNames, directoryText, nameMatcher, searchDirectory } from '../convex/lib/directory';
import { fakeDb } from './fakeDb';
import { disambiguatedMeetName, joinRoster, meetByName, oldestMeet } from '../convex/lib/meetData';
import { earliestLocalDate, meetStatusAt, meetStatusOn } from '../convex/lib/meetStatus';
import { distinctNameKeys, normalizeName } from '../convex/lib/names';
import { athleteGenderLabel, normalizeGender, storedGenderSpellings } from '../convex/lib/normalize';
import { computeStandards, filterWsoRows } from '../convex/lib/referenceData';

const composed = 'Jos\u00e9 Pe\u00f1a';
const decomposed = 'Jose\u0301 Pen\u0303a';

describe('normalizeName (#166)', () => {
  it('gives a precomposed and a decomposed spelling one key', () => {
    expect(decomposed).not.toBe(composed);
    expect(normalizeName(decomposed)).toBe(normalizeName(composed));
    expect(normalizeName(decomposed)).toBe('jos\u00e9 pe\u00f1a');
    expect(distinctNameKeys([composed, decomposed, ` ${composed.toUpperCase()} `])).toHaveLength(1);
  });

  it('still folds case and whitespace, and keeps compatibility characters apart (NFC, not NFKC)', () => {
    expect(normalizeName('  John \t  SMITH ')).toBe('john smith');
    expect(normalizeName('\ufb01lip')).not.toBe(normalizeName('filip'));
  });
});

describe('search directory folding (#166, #135)', () => {
  it('matches a query against a name stored in the other composition', () => {
    const text = directoryText(['Ann Lee', decomposed, 'Zed Jos']);
    expect(searchDirectory(text, 'Jos\u00e9', 8)).toEqual([composed]);
    expect(searchDirectory(directoryText([composed]), 'Jose\u0301', 8)).toEqual([composed]);
    expect(nameMatcher('jos\u00e9')(decomposed)).toBe(true);
    expect(searchDirectory(text, 'jos', 8)).toEqual([composed, 'Zed Jos']);
  });

  it('reads the directory as one name a line', () => {
    expect(directoryNames('Ann Lee\n\nBo Kim\n')).toEqual(['Ann Lee', 'Bo Kim']);
  });
});

describe('normalizeGender: one spelling per gender (#165)', () => {
  it.each([
    ['Male', 'Men'],
    [' female ', 'Women'],
    ['MEN', 'Men'],
    ['women', 'Women'],
    ['m', 'Men'],
    ['F', 'Women'],
    ['mixed', 'Mixed'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeGender(input)).toBe(expected);
  });

  it('lists the spellings a stored row may still hold', () => {
    expect(storedGenderSpellings('Men')).toEqual(['Men', 'Male']);
    expect(storedGenderSpellings('Women')).toEqual(['Women', 'Female']);
    expect(storedGenderSpellings('Mixed')).toEqual(['Mixed']);
  });

  it('answers athletes in the spelling the apps filter on, whatever is stored', () => {
    expect(['Men', 'Male', 'M'].map(athleteGenderLabel)).toEqual(['Male', 'Male', 'Male']);
    expect(['Women', 'Female', 'f'].map(athleteGenderLabel)).toEqual(['Female', 'Female', 'Female']);
    expect(athleteGenderLabel('')).toBe('');
  });
});

describe('meet status from dates (#158, #160)', () => {
  const meet = { startDate: '2026-10-10', endDate: '2026-10-12' };

  it('is upcoming before, ongoing during and completed after the meet', () => {
    expect(meetStatusOn(meet, '2026-10-09')).toBe('upcoming');
    expect(meetStatusOn(meet, '2026-10-10')).toBe('ongoing');
    expect(meetStatusOn(meet, '2026-10-12')).toBe('ongoing');
    expect(meetStatusOn(meet, '2026-10-13')).toBe('completed');
  });

  it("reads today on the meet's own calendar", () => {
    // 03:00 UTC on the 13th is still the 12th in New York and Los Angeles.
    const instant = Date.UTC(2026, 9, 13, 3);
    expect(meetStatusAt({ ...meet, timeZone: 'America/Los_Angeles' }, instant)).toBe('ongoing');
    expect(meetStatusAt({ ...meet, timeZone: 'America/New_York' }, instant)).toBe('ongoing');
    expect(meetStatusAt({ ...meet, timeZone: 'Europe/London' }, instant)).toBe('completed');
    // 06:00 UTC on the 10th is still the 9th in Los Angeles.
    expect(meetStatusAt({ ...meet, timeZone: 'America/Los_Angeles' }, Date.UTC(2026, 9, 10, 6))).toBe('upcoming');
  });

  it('reads a meet with no zone, or an unreadable one, on the calendar of UTC-12, never the UTC date', () => {
    const formatters = new Map();
    const noZone = [{ ...meet }, { ...meet, timeZone: '' }, { ...meet, timeZone: '  ' }, { ...meet, timeZone: 'Not/AZone' }];
    const statusesAt = (instant: number) => noZone.map((m) => meetStatusAt(m, instant, formatters));
    // 06:00 UTC on the 10th: the UTC date is the first day, but it has not
    // begun in UTC-12 (still 18:00 on the 9th), so the meet is not ongoing.
    expect(statusesAt(Date.UTC(2026, 9, 10, 6))).toEqual(['upcoming', 'upcoming', 'upcoming', 'upcoming']);
    // 12:00 UTC on the 10th: the first day has begun everywhere.
    expect(statusesAt(Date.UTC(2026, 9, 10, 12))).toEqual(['ongoing', 'ongoing', 'ongoing', 'ongoing']);
    // 03:00 UTC on the 13th: the UTC date is past the end, but it is still
    // the 12th west of UTC (20:00 in Los Angeles), so the meet is not completed.
    expect(statusesAt(Date.UTC(2026, 9, 13, 3))).toEqual(['ongoing', 'ongoing', 'ongoing', 'ongoing']);
    // 11:59 UTC on the 13th: the last day is still under way in UTC-12.
    expect(statusesAt(Date.UTC(2026, 9, 13, 11, 59))).toEqual(['ongoing', 'ongoing', 'ongoing', 'ongoing']);
    // 12:00 UTC on the 13th: the last day has ended everywhere.
    expect(statusesAt(Date.UTC(2026, 9, 13, 12))).toEqual(['completed', 'completed', 'completed', 'completed']);
    // A readable zone sharing the formatter cache is still read on its own calendar.
    expect(meetStatusAt({ ...meet, timeZone: 'Europe/London' }, Date.UTC(2026, 9, 13, 3), formatters)).toBe('completed');
  });

  it('reads unpadded dates in calendar order', () => {
    // "2026-9-25" sorts after "2026-10-12" as text.
    expect(meetStatusOn({ startDate: '2026-9-24', endDate: '2026-9-25' }, '2026-10-12')).toBe('completed');
    expect(meetStatusOn({ startDate: '2026-10-5', endDate: '2026-10-13' }, '2026-10-12')).toBe('ongoing');
    expect(meetStatusOn({ startDate: '2026-11-1', endDate: '2026-11-2' }, '2026-10-12')).toBe('upcoming');
  });

  it('never puts the earliest local date after any zone', () => {
    expect(earliestLocalDate(Date.UTC(2026, 9, 13, 5))).toBe('2026-10-12');
    expect(earliestLocalDate(Date.UTC(2026, 9, 13, 13))).toBe('2026-10-13');
  });
});

describe('meet identity helpers (#159)', () => {
  it('disambiguates a name by federation and picks the oldest of repeated names', () => {
    expect(disambiguatedMeetName('2027 Masters Nationals', 'USAMW')).toBe('2027 Masters Nationals (USAMW)');
    expect(disambiguatedMeetName('2027 Masters Nationals', 'USAMW', 2)).toBe('2027 Masters Nationals (USAMW 2)');
    expect(oldestMeet([{ _creationTime: 5, id: 'b' }, { _creationTime: 2, id: 'a' }])).toEqual({ _creationTime: 2, id: 'a' });
    expect(oldestMeet([])).toBeNull();
  });

  it('meetByName takes the oldest of a repeated name, and says so', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db } = fakeDb({ meets: [{ name: 'Open', federation: 'USAW' }, { name: 'Open', federation: 'USAMW' }] });
    expect(await meetByName({ db } as never, 'Open')).toEqual(expect.objectContaining({ federation: 'USAW' }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await meetByName({ db } as never, 'Missing')).toBeNull();
    warn.mockRestore();
  });
});

describe('readers before the gender migration (#165)', () => {
  it('answer athletes as Male / Female and reference rows as Men / Women, whatever is stored', async () => {
    const athlete = (gender: string) => ({ _id: gender, _creationTime: 1, memberId: '1', name: gender, age: 30, club: 'C', gender, weightClass: '64', entryTotal: 1, meet: 'M', adaptive: false });
    expect(joinRoster([athlete('Men'), athlete('Female')] as never, []).map((row) => row.gender)).toEqual(['Female', 'Male']);
    const { db } = fakeDb({ standards: [{ ageCategory: 'Senior', gender: 'Male', weightClass: '89', standardA: 1, standardB: 1 }] });
    expect((await computeStandards({ db } as never)).map((row) => row.gender)).toEqual(['Men']);
  });

  it('read a WSO records gender filter in the spelling the rows answer', () => {
    const row = { age_category: 'Senior', gender: 'Men', weight_class: '89' } as never;
    expect(filterWsoRows([row], undefined, 'male')).toEqual([row]);
    expect(filterWsoRows([row], undefined, 'Women')).toEqual([]);
  });
});
