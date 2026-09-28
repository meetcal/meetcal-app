import { correctRecordDate, recordHolder } from '../../convex/scrapers/parse/holder';

const today = new Date('2026-09-27T12:00:00Z');

describe('correctRecordDate', () => {
  it('corrects the dates the sources are known to have wrong, for their holder only', () => {
    expect(correctRecordDate('KULYK, Tamara', '11-June-0206', today)).toBe('2026-06-11');
    expect(correctRecordDate('CASSIDY, Wes', '10-June-0206', today)).toBe('2026-06-10');
    expect(correctRecordDate('SHNEIDMAN, Yakov', '2016-06-09', today)).toBe('2026-06-09');
    expect(correctRecordDate('Asher Hayhoe', '12//5/26', today)).toBe('2025-12-05');
    expect(correctRecordDate('Olivia Reeves', '12//5/26', today)).toBe('12//5/26');
    expect(correctRecordDate('Someone Else', '2016-06-09', today)).toBe('2016-06-09');
  });

  it('moves a date that has not happened yet back one year', () => {
    expect(correctRecordDate('Xander Whitlock', '2026-12-07', today)).toBe('2025-12-07');
    expect(correctRecordDate('Leap Lifter', '2028-02-29', today)).toBe('2027-02-28');
  });

  it('keeps past dates, dates a day or two ahead (time zones), text and blanks', () => {
    expect(correctRecordDate('A', '2026-09-27', today)).toBe('2026-09-27');
    expect(correctRecordDate('A', '2026-09-29', today)).toBe('2026-09-29');
    expect(correctRecordDate('A', '2026-09-30', today)).toBe('2025-09-30');
    expect(correctRecordDate('A', 'sometime', today)).toBe('sometime');
    expect(correctRecordDate('A', undefined, today)).toBeUndefined();
  });
});

describe('recordHolder', () => {
  it('corrects the date it reads', () => {
    expect(recordHolder(146, 'Asher Hayhoe', '12//5/26')).toEqual({ name: 'Asher Hayhoe', date: '2025-12-05' });
  });
});
