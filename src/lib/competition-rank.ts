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
  const ranks: number[] = [];
  totals.forEach((total, index) => {
    ranks.push(index > 0 && total === totals[index - 1] ? ranks[index - 1] : index + 1);
  });
  return ranks;
}
