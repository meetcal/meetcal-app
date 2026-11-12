import { isRecord } from '@/lib/is-record';
import { isLiftResult } from '@/lib/athletes';
import { LiftResult, AthleteMeetResult } from '@/data/types/athletes';
import { formatApiTime, normalizePlatform, type ApiScheduleRow } from '@/lib/api/api-meet-mappers';
import { assertHasFields, assertObject, nullableNumber, nullableString, toFiniteNumber } from '@/lib/api/api-validators';

export type ApiAthlete = {
  member_id?: string | null;
  adaptive?: boolean | null;
  age?: number | string | null;
  club?: string | null;
  entry_total?: number | string | null;
  gender?: string | null;
  meet?: string;
  name: string;
  session_number?: number | null;
  session_platform?: string | null;
  weight_class?: string | null;
  wso?: string | null;
};

export type ApiAthleteWithSession = ApiAthlete & {
  date?: string | null;
  start_time?: string | null;
  weigh_in_time?: string | null;
  schedule_row?: ApiScheduleRow | null;
  session?: {
    session_number: number;
    session_platform: string;
    date?: string | null;
    start_time?: string | null;
    weigh_in_time?: string | null;
  } | null;
};

export type ApiLiftingResult = {
  id?: number | null;
  event_id?: string | null;
  federation?: string | null;
  meet: string;
  date: string;
  name: string;
  age?: string | number | null;
  body_weight?: number | null;
  snatch1?: number | null;
  snatch2?: number | null;
  snatch3?: number | null;
  snatch_best?: number | null;
  cj1?: number | null;
  cj2?: number | null;
  cj3?: number | null;
  cj_best?: number | null;
  total?: number | null;
  adaptive?: boolean | null;
};

export type ApiYearBests = {
  best_snatch: number;
  best_cj: number;
  best_total: number;
};

export function mapApiAthlete(row: unknown): LiftResult {
  assertObject(row, 'athlete');
  const session = isRecord(row.session) ? row.session : {};
  const scheduleRow = isRecord(row.schedule_row) ? row.schedule_row : {};
  const firstText = (...values: unknown[]) => values.map(nullableString).find((value) => value !== null) ?? undefined;
  const sessionNumber = nullableNumber(row.session_number) ?? nullableNumber(session.session_number);
  const sessionPlatform = firstText(row.session_platform, session.session_platform);
  const date = firstText(row.date, scheduleRow.date, session.date);
  const startTime = firstText(row.start_time, scheduleRow.start_time, session.start_time);
  const weighInTime = firstText(row.weigh_in_time, scheduleRow.weigh_in_time, session.weigh_in_time);

  const athlete = {
    memberId: nullableString(row.member_id) || '',
    name: nullableString(row.name) ?? '',
    age: toFiniteNumber(row.age, 0),
    club: nullableString(row.club) ?? '',
    wso: nullableString(row.wso) || undefined,
    gender: nullableString(row.gender) || '',
    weightClass: nullableString(row.weight_class) || '',
    entryTotal: toFiniteNumber(row.entry_total, 0),
    adaptive: row.adaptive === true,
    session: sessionNumber !== null && sessionPlatform
      ? {
          number: sessionNumber,
          platform: normalizePlatform(sessionPlatform),
          ...(date !== undefined && { date }),
          ...(startTime !== undefined && { startTime: formatApiTime(startTime) }),
          ...(weighInTime !== undefined && { weighInTime: formatApiTime(weighInTime) }),
        }
      : undefined,
  };
  if (!isLiftResult(athlete)) throw new Error('athlete contains invalid fields');
  return athlete;
}

export function mapApiAthletes(rows: readonly unknown[], source: string): LiftResult[] {
  const athletes: LiftResult[] = [];
  let dropped = 0;
  for (const row of rows) {
    try {
      athletes.push(mapApiAthlete(row));
    } catch {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.warn(`[api] ${source}: dropped ${dropped} of ${rows.length} malformed athlete rows`);
  }
  return athletes;
}

function fallbackEventId(meet: string, date: string, name: string): string {
  return `${meet}|${date}|${name}`;
}

export function mapApiLiftingResult(row: unknown): AthleteMeetResult {
  assertObject(row, 'lifting result');
  const meet = nullableString(row.meet) ?? '';
  const date = nullableString(row.date) ?? '';
  const name = nullableString(row.name) ?? '';
  return {
    event_id: nullableString(row.event_id) || fallbackEventId(meet, date, name),
    meet,
    date,
    name,
    age: nullableString(row.age) ?? nullableNumber(row.age) ?? '',
    body_weight: nullableNumber(row.body_weight) ?? 0,
    snatch1: nullableNumber(row.snatch1),
    snatch2: nullableNumber(row.snatch2),
    snatch3: nullableNumber(row.snatch3),
    snatch_best: nullableNumber(row.snatch_best),
    cj1: nullableNumber(row.cj1),
    cj2: nullableNumber(row.cj2),
    cj3: nullableNumber(row.cj3),
    cj_best: nullableNumber(row.cj_best),
    total: nullableNumber(row.total),
  };
}

export function mapApiYearBests(row: ApiYearBests) {
  return {
    bestSnatch: toFiniteNumber(row.best_snatch),
    bestCJ: toFiniteNumber(row.best_cj),
    bestTotal: toFiniteNumber(row.best_total),
  };
}

export function parseNamedBests(rows: unknown[], label: string): { name: string; bests: ApiYearBests }[] {
  return rows.map((row, index) => {
    const fields = assertHasFields(row, `${label}[${index}]`, ['name', 'best_snatch', 'best_cj', 'best_total']);
    if (typeof fields.name !== 'string') throw new Error(`${label}[${index}] has invalid name`);
    return {
      name: fields.name,
      bests: {
        best_snatch: toFiniteNumber(fields.best_snatch),
        best_cj: toFiniteNumber(fields.best_cj),
        best_total: toFiniteNumber(fields.best_total),
      },
    };
  });
}
