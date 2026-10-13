import type { IntlRanking } from '@/lib/database/fetchIntlRankings';
import { computeDefaultRankingFilters, filterIntlRankings } from '@/lib/rankings-filters';

function ranking(overrides: Partial<IntlRanking>): IntlRanking {
  return {
    meet: 'World Championships',
    ranking: 1,
    name: 'Athlete',
    weightClass: '89',
    total: 300,
    percentA: 95,
    gender: 'Men',
    ageCategory: 'Senior',
    ...overrides,
  };
}

describe('computeDefaultRankingFilters', () => {
  it('takes the first meet in data order, not alphabetical order', () => {
    // Reset used `meetOptions[0]` (sorted: "Asian Games") while the first
    // load used the first row ("World Championships").
    const filters = computeDefaultRankingFilters([
      ranking({ meet: 'World Championships' }),
      ranking({ meet: 'Asian Games' }),
    ]);

    expect(filters).toEqual({
      meet: 'World Championships',
      age_category: 'Senior',
      gender: 'Men',
    });
  });

  it('gives the same answer every time for the same rankings', () => {
    const rankings = [
      ranking({ meet: 'Pan Ams', ageCategory: 'Junior', gender: 'Women' }),
      ranking({ meet: 'Asian Games', ageCategory: 'Senior', gender: 'Men' }),
    ];

    expect(computeDefaultRankingFilters(rankings)).toEqual(
      computeDefaultRankingFilters([...rankings]),
    );
  });

  it("picks the age category and gender from the default meet's rows", () => {
    // Senior and Men exist elsewhere, but not at the default meet: choosing
    // them would open on an empty table.
    const filters = computeDefaultRankingFilters([
      ranking({ meet: 'Youth Worlds', ageCategory: 'Youth', gender: 'Women' }),
      ranking({ meet: 'Youth Worlds', ageCategory: 'U17', gender: 'Women' }),
      ranking({ meet: 'Senior Worlds', ageCategory: 'Senior', gender: 'Men' }),
    ]);

    expect(filters).toEqual({
      meet: 'Youth Worlds',
      age_category: 'U17',
      gender: 'Women',
    });
  });

  it('picks a gender that exists for the chosen age category', () => {
    // The meet has Senior and it has Men, but no Senior men. Senior/Men
    // matches no row.
    const filters = computeDefaultRankingFilters([
      ranking({ ageCategory: 'Senior', gender: 'Women' }),
      ranking({ ageCategory: 'Junior', gender: 'Men' }),
    ]);

    expect(filters).toEqual({
      meet: 'World Championships',
      age_category: 'Senior',
      gender: 'Women',
    });
  });

  it('prefers Senior and Men when the meet has them', () => {
    const filters = computeDefaultRankingFilters([
      ranking({ ageCategory: 'Junior', gender: 'Women' }),
      ranking({ ageCategory: 'Senior', gender: 'Men' }),
    ]);

    expect(filters.age_category).toBe('Senior');
    expect(filters.gender).toBe('Men');
  });

  it('is empty for no rankings', () => {
    expect(computeDefaultRankingFilters([])).toEqual({
      meet: '',
      age_category: '',
      gender: '',
    });
  });
});

describe('filterIntlRankings', () => {
  const rows = [
    ranking({ name: 'B', ranking: 2 }),
    ranking({ name: 'A', ranking: 1 }),
    ranking({ name: 'W', gender: 'Women', ranking: 1 }),
    ranking({ name: 'J', ageCategory: 'Junior', ranking: 1 }),
    ranking({ name: 'X', meet: 'Asian Games', ranking: 1 }),
  ];

  it('keeps the rows matching every filter, best rank first', () => {
    expect(
      filterIntlRankings(rows, {
        meet: 'World Championships',
        age_category: 'Senior',
        gender: 'Men',
      }).map((r) => r.name),
    ).toEqual(['A', 'B']);
  });

  it('gives a different count when only the gender changes', () => {
    // The filter sheet counts the edited values with this, not the applied ones.
    const base = { meet: 'World Championships', age_category: 'Senior' };
    expect(filterIntlRankings(rows, { ...base, gender: 'Men' })).toHaveLength(2);
    expect(filterIntlRankings(rows, { ...base, gender: 'Women' })).toHaveLength(1);
  });

  it('treats an empty filter value as matching every row', () => {
    expect(filterIntlRankings(rows, { meet: '', age_category: '', gender: '' })).toHaveLength(5);
  });
});
