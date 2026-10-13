import { selectQualifyingTotals, selectStandards } from '@/lib/comp-data-filters';
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
