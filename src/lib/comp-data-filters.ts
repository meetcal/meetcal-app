import type { QualifyingTotalsData } from '@/lib/database/fetch-qualifying-totals';
import type { StandardsData } from '@/types/standards';

/**
 * Row selection for the comp-data screens whose whole dataset is loaded at
 * once. The screen's table uses the applied filters and the filter sheet's
 * count uses the sheet's edited ones, so both go through one function.
 */

type FilterValues = Readonly<Record<string, string | undefined>>;

export type StandardsRow = StandardsData[string][string][number];

/** The A/B standards for a gender and age group; `[]` when either is missing. */
export function selectStandards(
  data: StandardsData,
  filters: FilterValues,
): StandardsRow[] {
  const { ageGroup, gender } = filters;
  if (!ageGroup || !gender) return [];
  return data[ageGroup]?.[gender] ?? [];
}

export type QualifyingTotalRow = { bodyweightDivision: string; qt: number };

/** The qualifying totals for an event, age group and gender, one per weight class. */
export function selectQualifyingTotals(
  data: QualifyingTotalsData,
  filters: FilterValues,
): QualifyingTotalRow[] {
  const { event, ageGroup, gender } = filters;
  if (!event || !ageGroup || (gender !== 'Men' && gender !== 'Women')) return [];
  const genderData = data[event]?.[ageGroup]?.[gender];
  if (!genderData) return [];
  return Object.entries(genderData).map(([bodyweightDivision, qt]) => ({
    bodyweightDivision,
    qt,
  }));
}
