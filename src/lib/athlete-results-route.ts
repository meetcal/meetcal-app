import type { AthleteRequest } from '@/lib/api/results-api';
import type { Href } from 'expo-router';

export type AthleteResultsParams = {
  name?: string | string[];
  lifter?: string | string[];
  membership?: string | string[];
  other?: string | string[];
};

const OTHER_RESULTS = '1';

function firstValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first.trim() === '' ? undefined : first;
}

export function athleteResultsHref(request: AthleteRequest): Href {
  const params: Record<string, string> = { name: request.name };
  if (request.lifter) params.lifter = request.lifter;
  if (request.membership) params.membership = request.membership;
  if (request.other) params.other = OTHER_RESULTS;
  return { pathname: '/shared-screens/athlete-results', params };
}

export function athleteRequestOf(params: AthleteResultsParams): AthleteRequest | null {
  const name = firstValue(params.name);
  if (name === undefined) return null;
  return {
    name,
    lifter: firstValue(params.lifter),
    membership: firstValue(params.membership),
    other: firstValue(params.other) === OTHER_RESULTS,
  };
}

export function athleteRequestKey(request: AthleteRequest): string {
  return JSON.stringify([request.name, request.lifter ?? '', request.membership ?? '', request.other === true]);
}

export function rowsForRequest<Row extends { lifter_id?: string }>(rows: Row[], request: AthleteRequest): Row[] {
  if (request.lifter) return rows.filter((row) => row.lifter_id === request.lifter);
  if (request.other) return rows.filter((row) => row.lifter_id === undefined);
  return rows;
}
