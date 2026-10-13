import { correctRecordDate, recordHolder } from '../../convex/scrapers/parse/holder';

const today = new Date('2026-09-27T12:00:00Z');
// After the slipped December 2026 dates have passed: the corrections must not depend on the run date.
const nextYear = new Date('2027-01-15T12:00:00Z');

describe('correctRecordDate', () => {
  it('corrects the dates the sources are known to have wrong, for their holder only', () => {
    expect(correctRecordDate('KULYK, Tamara', '11-June-0206', today)).toBe('2026-06-11');
    expect(correctRecordDate('CASSIDY, Wes', '10-June-0206', today)).toBe('2026-06-10');
    expect(correctRecordDate('SHNEIDMAN, Yakov', '2016-06-09', today)).toBe('2026-06-09');
    expect(correctRecordDate('Asher Hayhoe', '12//5/26', today)).toBe('2025-12-05');
    expect(correctRecordDate('Olivia Reeves', '12//5/26', today)).toBe('12//5/26');
    expect(correctRecordDate('Someone Else', '2016-06-09', today)).toBe('2016-06-09');
  });

  it('corrects the December 2025 Virus Finals written as 2026 whatever the day it runs', () => {
    for (const day of [today, new Date('2026-12-03T12:00:00Z'), new Date('2026-12-08T12:00:00Z'), nextYear]) {
      expect(correctRecordDate('Xander Whitlock', '2026-12-07', day)).toBe('2025-12-07');
      expect(correctRecordDate('Kellie Moylan', '2026-12-04', day)).toBe('2025-12-04');
    }
  });

  it('fails on a date that has not happened yet rather than guessing its year', () => {
    expect(() => correctRecordDate('Someone Else', '2026-12-07', today)).toThrow('record date 2026-12-07 for "Someone Else" is in the future');
    expect(() => correctRecordDate('Leap Lifter', '2028-02-29', today)).toThrow('in the future');
    // Once the day has come it is a date like any other.
    expect(correctRecordDate('Someone Else', '2026-12-07', nextYear)).toBe('2026-12-07');
  });

  it('keeps past dates, dates a day or two ahead (time zones), text and blanks', () => {
    expect(correctRecordDate('A', '2026-09-27', today)).toBe('2026-09-27');
    expect(correctRecordDate('A', '2026-09-29', today)).toBe('2026-09-29');
    expect(() => correctRecordDate('A', '2026-09-30', today)).toThrow('in the future');
    expect(correctRecordDate('A', 'sometime', today)).toBe('sometime');
    expect(correctRecordDate('A', undefined, today)).toBeUndefined();
  });
});

describe('recordHolder', () => {
  afterEach(() => jest.useRealTimers());

  it('corrects the date it reads', () => {
    expect(recordHolder(146, 'Asher Hayhoe', '12//5/26')).toEqual({ name: 'Asher Hayhoe', date: '2025-12-05' });
  });

  it('corrects a December 2025 date written as 2026 after that day in 2026 has passed', () => {
    jest.useFakeTimers({ now: nextYear });
    expect(recordHolder(93, 'Xander Whitlock', '12/7/2026', '2025 Virus Series Finals')).toEqual({
      name: 'Xander Whitlock',
      date: '2025-12-07',
      location: '2025 Virus Series Finals',
    });
    expect(recordHolder(34, 'Kellie Moylan', '12/4/26', 'Daytona Beach, FL')).toEqual({ name: 'Kellie Moylan', date: '2025-12-04', location: 'Daytona Beach, FL' });
  });

  it('fails on a date in the future', () => {
    jest.useFakeTimers({ now: today });
    expect(() => recordHolder(100, 'New Lifter', '12/6/2026')).toThrow('record date 2026-12-06 for "New Lifter" is in the future');
  });
});
