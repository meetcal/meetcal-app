import type { IntlRanking } from '@/lib/database/fetchIntlRankings';
import { sortAgeGroups } from '@/lib/sortAgeGroups';
import type { Filters } from '@/types/rankings';

const PREFERRED_AGE_CATEGORY = 'Senior';
const PREFERRED_GENDER = 'Men';

function distinct(values: readonly string[]): string[] {
  return Array.from(new Set(values)).filter(Boolean);
}

/**
 * The International Rankings screen's default filters: what it opens on when
 * no route filters are given, and what Reset goes back to. Both paths call
 * this, so Reset restores the screen's original state. They used to differ:
 * the first load took the first meet in data order and Reset the first meet
 * in alphabetical order.
 *
 * Every default is taken from rows that exist, so the three together always
 * match at least one row.
 *
 * The meet is the first in data order. The age category comes from that
 * meet's rows: Senior when it has any, else the first in display order. The
 * gender comes from the rows of that meet *and* age category: Men when there
 * are any, else the first alphabetically. Choosing the gender from the whole
 * meet could pair Senior with Men at a meet that has Senior women and Junior
 * men only, and the screen would open on an empty table.
 */
export function computeDefaultRankingFilters(
  rankings: readonly IntlRanking[],
): Filters {
  const meet = rankings[0]?.meet ?? '';
  const meetRows = rankings.filter((ranking) => ranking.meet === meet);

  const ageCategories = sortAgeGroups(
    distinct(meetRows.map((ranking) => ranking.ageCategory)),
    { includeExtended: true },
  );
  const ageCategory = ageCategories.includes(PREFERRED_AGE_CATEGORY)
    ? PREFERRED_AGE_CATEGORY
    : ageCategories[0] ?? '';

  const genders = distinct(
    meetRows
      .filter((ranking) => ranking.ageCategory === ageCategory)
      .map((ranking) => ranking.gender),
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  return {
    meet,
    age_category: ageCategory,
    gender: genders.includes(PREFERRED_GENDER) ? PREFERRED_GENDER : genders[0] ?? '',
  };
}

/**
 * The International Rankings rows a set of filters shows, best rank first. An
 * empty filter value matches every row. The screen's table and the filter
 * sheet's count (for the sheet's edited values) both use this.
 */
export function filterIntlRankings(
  rankings: readonly IntlRanking[],
  filters: Readonly<Record<string, string | undefined>>,
): IntlRanking[] {
  return rankings
    .filter(
      (r) =>
        (!filters.meet || r.meet === filters.meet) &&
        (!filters.age_category || r.ageCategory === filters.age_category) &&
        (!filters.gender || r.gender === filters.gender),
    )
    .sort(
      (a, b) =>
        (a.ranking ?? Number.MAX_SAFE_INTEGER) -
        (b.ranking ?? Number.MAX_SAFE_INTEGER),
    );
}
