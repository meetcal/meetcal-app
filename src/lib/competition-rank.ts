/**
 * Competition ("1224") ranking for a list already ordered best first.
 *
 * Equal totals share a rank, and the next distinct total takes its position
 * in the list (index + 1), so two athletes tied for 2nd are both 2 and the
 * next is 4. The server orders equal totals by name, so ranking by position
 * alone decided ties alphabetically. The website's National Rankings uses the
 * same rule.
 */
export function competitionRanks(totals: readonly number[]): number[] {
  let previousTotal: number | undefined;
  let previousRank = 0;
  return totals.map((total, index) => {
    const rank = index > 0 && total === previousTotal ? previousRank : index + 1;
    previousTotal = total;
    previousRank = rank;
    return rank;
  });
}
