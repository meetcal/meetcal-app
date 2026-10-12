import type { IntlRanking } from '@/lib/database/fetchIntlRankings';
import { computeDefaultRankingFilters } from '@/lib/rankings-filters';

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
