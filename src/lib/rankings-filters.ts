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
 * The meet is the first in data order. The age category and gender come
 * from that meet's rows, so the defaults never combine into an empty table:
 * Senior and Men when the meet has them, else the first in display order.
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
  const genders = distinct(meetRows.map((ranking) => ranking.gender)).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );

  return {
    meet,
    age_category: ageCategories.includes(PREFERRED_AGE_CATEGORY)
      ? PREFERRED_AGE_CATEGORY
      : ageCategories[0] ?? '',
    gender: genders.includes(PREFERRED_GENDER) ? PREFERRED_GENDER : genders[0] ?? '',
  };
}
