import { canonicalizePlatform } from '@/lib/athletes';
import { Platform } from '@/data/types/athletes';
import { Meet } from '@/data/types/meet';
import type { Schedule } from '@/types/schedule';
import { getTimeZoneAbbreviation, meetCalendarDateAnchor } from '@/utils/dateTime';
import { convertZonedLocalToUTC, getOffsetMinutesAtInstant, isValidTimeZone, parseClockTime } from '@/utils/timezone';
import { assertArray, assertHasFields, assertObject, nullableString } from '@/lib/api/api-validators';
import type { ApiMeetPackage } from '@/lib/api/meet-package-api';

const MEET_DATE_OFFSET_PROBE_TIME = '12:00';

function instantForMeetDate(dateIso: string | null | undefined, timeZone: string): Date {
  const [datePart] = typeof dateIso === 'string' ? dateIso.split('T') : [''];
  try {
    return convertZonedLocalToUTC(datePart ?? '', MEET_DATE_OFFSET_PROBE_TIME, timeZone);
  } catch {
    return new Date();
  }
}

const FALLBACK_TIME_ZONE = 'America/New_York';

function resolveTimeZoneIdentifier(
  value: string,
): { identifier: string; known: boolean } {
  if (isValidTimeZone(value)) {
    return { identifier: value, known: true };
  }
  console.warn(
    `[api] unknown meet time zone ${JSON.stringify(value)}, falling back to ${FALLBACK_TIME_ZONE}`,
  );
  return { identifier: FALLBACK_TIME_ZONE, known: false };
}

export type ApiMeet = {
  id?: string | null;
  federation?: string | null;
  end_date: string;
  name: string;
  start_date: string;
  time_zone: string;
  venue_city?: string | null;
  venue_name?: string | null;
  venue_state?: string | null;
  venue_street?: string | null;
  venue_zip?: string | null;
  venue_map_pdf_url?: string | null;
  venue_map_apple_url?: string | null;
  status: string;
};

export type ApiScheduleRow = {
  date: string;
  meet?: string;
  platform?: string | null;
  session_id: number;
  start_time?: string | null;
  weigh_in_time?: string | null;
  weight_class?: string | null;
};

function getUTCOffsetHours(timeZoneIdentifier: string, instant: Date): number {
  const hours = -getOffsetMinutesAtInstant(timeZoneIdentifier, instant) / 60;
  return hours === 0 ? 0 : hours;
}

export function normalizePlatform(platform: string | null | undefined): Platform {
  return canonicalizePlatform(platform);
}

export function formatApiTime(time: string | null | undefined): string {
  if (!time) return '';
  try {
    const { hour, minute } = parseClockTime(time);
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHours = hour % 12 || 12;
    return `${displayHours}:${minute.toString().padStart(2, '0')} ${period}`;
  } catch {
    return '';
  }
}

function formatScheduleDay(date: string): string {
  const anchor = meetCalendarDateAnchor(date);
  if (!anchor) return date;
  return anchor.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export type MappedMeet = Meet & { timeZoneUnknown: boolean };

export function mapApiMeet(row: unknown): MappedMeet {
  assertObject(row, 'meet');
  const name = nullableString(row.name) ?? '';
  const timeZone = nullableString(row.time_zone) ?? '';
  const startDate = nullableString(row.start_date) ?? '';
  const { identifier: timeZoneIdentifier, known } = resolveTimeZoneIdentifier(timeZone);
  const meetInstant = instantForMeetDate(startDate, timeZoneIdentifier);
  const status =
    row.status === 'ongoing' || row.status === 'completed' || row.status === 'upcoming'
      ? row.status
      : 'upcoming';
  return {
    id: nullableString(row.id) || name,
    name,
    venue: {
      name: nullableString(row.venue_name) ?? '',
      address: {
        street: nullableString(row.venue_street) ?? '',
        city: nullableString(row.venue_city) ?? '',
        state: nullableString(row.venue_state) ?? '',
        zip: nullableString(row.venue_zip) ?? '',
      },
    },
    venueMapPdfUrl: nullableString(row.venue_map_pdf_url),
    venueMapAppleUrl: nullableString(row.venue_map_apple_url),
    time: {
      timeZone,
      timeZoneIdentifier,
      abbreviation: getTimeZoneAbbreviation(timeZoneIdentifier, meetInstant),
      utcOffset: getUTCOffsetHours(timeZoneIdentifier, meetInstant),
    },
    dates: {
      start: startDate,
      end: nullableString(row.end_date) ?? '',
    },
    status,
    timeZoneUnknown: !known,
  };
}

function assertApiScheduleRow(row: unknown, label: string): ApiScheduleRow {
  assertObject(row, label);
  const { date, session_id } = row;
  if (typeof date !== 'string' || typeof session_id !== 'number' || !Number.isFinite(session_id)) {
    throw new Error(`${label} has an invalid date or session_id`);
  }
  return {
    date,
    session_id,
    meet: nullableString(row.meet) ?? undefined,
    platform: nullableString(row.platform),
    start_time: nullableString(row.start_time),
    weigh_in_time: nullableString(row.weigh_in_time),
    weight_class: nullableString(row.weight_class),
  };
}

export function mapApiSchedule(rows: readonly unknown[]): Schedule {
  const scheduleMap = new Map<string, {
    date: string;
    fullDate: string;
    sessions: Map<number, Schedule[number]['sessions'][number]>;
  }>();

  rows.forEach((unchecked, index) => {
    const row = assertApiScheduleRow(unchecked, `schedule[${index}]`);
    if (!scheduleMap.has(row.date)) {
      scheduleMap.set(row.date, {
        date: formatScheduleDay(row.date),
        fullDate: row.date,
        sessions: new Map(),
      });
    }
    const dayData = scheduleMap.get(row.date)!;
    if (!dayData.sessions.has(row.session_id)) {
      dayData.sessions.set(row.session_id, {
        id: String(row.session_id),
        number: row.session_id,
        startTime: formatApiTime(row.start_time),
        weighInTime: formatApiTime(row.weigh_in_time),
        platforms: [],
      });
    }
    const session = dayData.sessions.get(row.session_id)!;
    session.platforms.push({
      platform: normalizePlatform(row.platform),
      weightClass: nullableString(row.weight_class) ?? '',
      platformStartTime: formatApiTime(row.start_time),
      platformWeighInTime: formatApiTime(row.weigh_in_time),
    });
  });

  return Array.from(scheduleMap.values()).map((day) => ({
    date: day.date,
    fullDate: day.fullDate,
    sessions: Array.from(day.sessions.values()).sort((a, b) => a.number - b.number),
  }));
}

export function mapPackageSchedule(pkg: ApiMeetPackage): Schedule {
  const meet = nullableString(pkg.meet.name) ?? '';
  const rows: Record<string, unknown>[] = [];
  pkg.schedule.forEach((day, dayIndex) => {
    const dayLabel = `/meets/package.schedule[${dayIndex}]`;
    assertObject(day, dayLabel);
    assertArray(day.sessions, `${dayLabel}.sessions`).forEach((session, sessionIndex) => {
      const sessionLabel = `${dayLabel}.sessions[${sessionIndex}]`;
      assertObject(session, sessionLabel);
      assertArray(session.platforms, `${sessionLabel}.platforms`).forEach((platform, platformIndex) => {
        assertObject(platform, `${sessionLabel}.platforms[${platformIndex}]`);
        rows.push({
          date: day.date,
          meet,
          platform: platform.platform,
          session_id: session.session_id,
          start_time: platform.start_time ?? session.start_time,
          weigh_in_time: platform.weigh_in_time ?? session.weigh_in_time,
          weight_class: platform.weight_class,
        });
      });
    });
  });
  return mapApiSchedule(rows);
}

function readApiMeet(row: Record<string, unknown>, label: string): ApiMeet {
  const { name, start_date, end_date, time_zone } = row;
  if (typeof name !== 'string' || typeof start_date !== 'string' || typeof end_date !== 'string' || typeof time_zone !== 'string') {
    const invalid = ['name', 'start_date', 'end_date', 'time_zone'].filter((field) => typeof row[field] !== 'string');
    throw new Error(`${label} has invalid fields: ${invalid.join(', ')}`);
  }
  return {
    id: nullableString(row.id),
    federation: nullableString(row.federation),
    name,
    start_date,
    end_date,
    time_zone,
    venue_city: nullableString(row.venue_city),
    venue_name: nullableString(row.venue_name),
    venue_state: nullableString(row.venue_state),
    venue_street: nullableString(row.venue_street),
    venue_zip: nullableString(row.venue_zip),
    venue_map_pdf_url: nullableString(row.venue_map_pdf_url),
    venue_map_apple_url: nullableString(row.venue_map_apple_url),
    status: nullableString(row.status) ?? '',
  };
}

export function validateApiMeets(json: unknown): ApiMeet[] {
  return assertArray(json, '/meets').map((row, index) =>
    readApiMeet(
      assertHasFields(row, `/meets[${index}]`, ['name', 'start_date', 'end_date', 'time_zone', 'status']),
      `/meets[${index}]`,
    ),
  );
}

export function validateApiMeetDetails(json: unknown): ApiMeet {
  return readApiMeet(
    assertHasFields(json, '/meets/details', ['name', 'start_date', 'end_date', 'time_zone']),
    '/meets/details',
  );
}

export function validateApiSchedule(json: unknown): ApiScheduleRow[] {
  return assertArray(json, '/meets/schedule').map((row, index) =>
    assertApiScheduleRow(row, `/meets/schedule[${index}]`),
  );
}
