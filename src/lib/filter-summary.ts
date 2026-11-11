const FILTER_SUMMARY_SEPARATOR = " • ";

export function filterSummary(
  parts: readonly (string | null | undefined)[],
  placeholderWhenNothingIsChosen: string,
): string {
  const chosen = parts.filter((part): part is string => Boolean(part?.trim()));
  return chosen.length > 0
    ? chosen.join(FILTER_SUMMARY_SEPARATOR)
    : placeholderWhenNothingIsChosen;
}
