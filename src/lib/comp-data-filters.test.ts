import {
  defaultQualifyingEvent,
  selectQualifyingTotals,
  selectStandards,
  sortQualifyingEvents,
} from '@/lib/comp-data-filters';
import type { QualifyingTotalsData } from '@/lib/database/fetch-qualifying-totals';
import type { StandardsData } from '@/types/standards';

const STANDARDS: StandardsData = {
  senior: {
    men: [
      { weightClass: '60', a: 250, b: 240 },
      { weightClass: '65', a: 270, b: 260 },
    ],
    women: [{ weightClass: '48', a: 170, b: 160 }],
  },
};

const TOTALS: QualifyingTotalsData = {
  Nationals: {
    Senior: { Men: { '60': 220, '65': 235, '71': 250 }, Women: { '48': 150 } },
  },
};

describe('selectStandards', () => {
  it('returns the rows for the given gender and age group', () => {
    expect(selectStandards(STANDARDS, { gender: 'men', ageGroup: 'senior' })).toHaveLength(2);
    expect(selectStandards(STANDARDS, { gender: 'women', ageGroup: 'senior' })).toEqual([
      { weightClass: '48', a: 170, b: 160 },
    ]);
  });

  it('is empty for an unknown or blank filter', () => {
    expect(selectStandards(STANDARDS, { gender: 'men', ageGroup: 'junior' })).toEqual([]);
    expect(selectStandards(STANDARDS, { gender: '', ageGroup: 'senior' })).toEqual([]);
    expect(selectStandards({}, { gender: 'men', ageGroup: 'senior' })).toEqual([]);
  });
});

describe('selectQualifyingTotals', () => {
  it('returns one row per weight class for the event, age group and gender', () => {
    expect(
      selectQualifyingTotals(TOTALS, { event: 'Nationals', ageGroup: 'Senior', gender: 'Men' }),
    ).toEqual([
      { bodyweightDivision: '60', qt: 220 },
      { bodyweightDivision: '65', qt: 235 },
      { bodyweightDivision: '71', qt: 250 },
    ]);
    expect(
      selectQualifyingTotals(TOTALS, { event: 'Nationals', ageGroup: 'Senior', gender: 'Women' }),
    ).toHaveLength(1);
  });

  it('is empty for an unknown event, age group or gender', () => {
    expect(selectQualifyingTotals(TOTALS, { event: 'Worlds', ageGroup: 'Senior', gender: 'Men' })).toEqual([]);
    expect(selectQualifyingTotals(TOTALS, { event: 'Nationals', ageGroup: 'Junior', gender: 'Men' })).toEqual([]);
    expect(selectQualifyingTotals(TOTALS, { event: 'Nationals', ageGroup: 'Senior', gender: '' })).toEqual([]);
  });
});

const EVENTS = [
  'IMWA Worlds',
  '2026 Virus Series',
  '2027 Series',
  '2027 Nationals (Adaptive)',
  '2027 Nationals',
  "Master's Pan Ams",
  '2026 Virus Finals',
];

describe('sortQualifyingEvents', () => {
  it('lists the newest season first, then events without a season, by name within each', () => {
    expect(sortQualifyingEvents(EVENTS)).toEqual([
      '2027 Nationals',
      '2027 Nationals (Adaptive)',
      '2027 Series',
      '2026 Virus Finals',
      '2026 Virus Series',
      'IMWA Worlds',
      "Master's Pan Ams",
    ]);
  });
});

describe('defaultQualifyingEvent', () => {
  it("opens on the newest season's Nationals, not its adaptive set", () => {
    expect(defaultQualifyingEvent(EVENTS)).toBe('2027 Nationals');
    expect(defaultQualifyingEvent(['2026 Nationals', '2028 Nationals', '2027 Nationals'])).toBe('2028 Nationals');
  });

  it('falls back to a season-less Nationals, then the first event, then nothing', () => {
    expect(defaultQualifyingEvent(['Virus Series', 'Nationals'])).toBe('Nationals');
    expect(defaultQualifyingEvent(['IMWA Worlds', '2027 Series'])).toBe('2027 Series');
    expect(defaultQualifyingEvent([])).toBe('');
  });
});
