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

const EVENT_YEAR = /^(\d{4}) /;

/**
 * Qualifying-total events for the event picker: sets named for a season
 * ("2027 Series") newest season first, then the rest; by name within each.
 */
export function sortQualifyingEvents(events: readonly string[]): string[] {
  const year = (event: string) => Number(EVENT_YEAR.exec(event)?.[1] ?? 0);
  return [...events].sort(
    (a, b) => year(b) - year(a) || a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

/**
 * The event the screen opens on: the newest season's "YYYY Nationals", else
 * an unnamed-season "Nationals", else the first event. `''` with no events.
 */
export function defaultQualifyingEvent(events: readonly string[]): string {
  const sorted = sortQualifyingEvents(events);
  return (
    sorted.find((event) => /^\d{4} Nationals$/.test(event)) ??
    sorted.find((event) => event === 'Nationals') ??
    sorted[0] ??
    ''
  );
}
