import type { Meet } from '@/data/types/meet';
import { isValidTimeZone } from '@/utils/timezone';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function everyFieldIsText(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => typeof record[field] === 'string');
}

function isMeetStatus(value: unknown): value is Meet['status'] {
  return value === 'upcoming' || value === 'ongoing' || value === 'completed';
}

function toStoredMeet(value: unknown): Meet | null {
  if (!isObject(value) || !everyFieldIsText(value, ['id', 'name'])) return null;
  const { venue, time, dates } = value;
  if (!isObject(venue) || typeof venue.name !== 'string' || !isObject(venue.address)) return null;
  if (!everyFieldIsText(venue.address, ['street', 'city', 'state', 'zip'])) return null;
  if (!isObject(time) || !everyFieldIsText(time, ['timeZone', 'timeZoneIdentifier', 'abbreviation'])) return null;
  if (typeof time.utcOffset !== 'number' || !Number.isFinite(time.utcOffset)) return null;
  if (!isValidTimeZone(String(time.timeZoneIdentifier))) return null;
  if (!isObject(dates) || !everyFieldIsText(dates, ['start', 'end'])) return null;
  if (!isMeetStatus(value.status)) return null;
  return {
    id: String(value.id),
    name: String(value.name),
    venue: {
      name: venue.name,
      address: {
        street: String(venue.address.street),
        city: String(venue.address.city),
        state: String(venue.address.state),
        zip: String(venue.address.zip),
      },
    },
    venueMapPdfUrl: typeof value.venueMapPdfUrl === 'string' ? value.venueMapPdfUrl : null,
    venueMapAppleUrl: typeof value.venueMapAppleUrl === 'string' ? value.venueMapAppleUrl : null,
    time: {
      timeZone: String(time.timeZone),
      timeZoneIdentifier: String(time.timeZoneIdentifier),
      abbreviation: String(time.abbreviation),
      utcOffset: time.utcOffset,
    },
    dates: { start: String(dates.start), end: String(dates.end) },
    status: value.status,
    ...(value.timeZoneUnknown === true ? { timeZoneUnknown: true } : {}),
  };
}

export function parseStoredMeetNamed(raw: string | null, expectedName: string): Meet | null {
  if (!raw) return null;
  try {
    const meet = toStoredMeet(JSON.parse(raw));
    return meet?.name === expectedName ? meet : null;
  } catch {
    return null;
  }
}
