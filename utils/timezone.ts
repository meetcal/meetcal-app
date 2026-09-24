type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/**
 * Formatters kept per zone id. Mirrors `ABBREVIATION_FORMATTER_CACHE_LIMIT` in
 * `utils/dateTime.ts`: a meet list spans a handful of US zones, and the bound
 * keeps odd spellings of the same zone from accumulating for the process life.
 */
export const PARTS_FORMATTER_CACHE_LIMIT = 32;
/**
 * Half-width of the window probed for a DST transition around a wall-clock
 * time: every US offset change lands inside +/- 12 hours of it.
 */
const DST_PROBE_WINDOW_MS = 12 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

/**
 * `Intl.DateTimeFormat` treats a missing `timeZone` as "the device zone", so an
 * `undefined` that slipped past the types (a persisted row, an unmapped API
 * field) would silently render meet-local times in the phone's zone. Fail
 * loudly instead; every caller already turns a throw into a skip or fallback.
 */
function assertTimeZone(timeZone: unknown): asserts timeZone is string {
  if (typeof timeZone !== "string" || timeZone.trim().length === 0) {
    throw new Error(`Invalid time zone: ${JSON.stringify(timeZone)}`);
  }
}

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  assertTimeZone(timeZone);
  const cached = PARTS_FORMATTER_CACHE.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // Insertion-ordered eviction: `Map` keys iterate oldest-first.
  while (PARTS_FORMATTER_CACHE.size >= PARTS_FORMATTER_CACHE_LIMIT) {
    const oldest = PARTS_FORMATTER_CACHE.keys().next();
    if (oldest.done) break;
    PARTS_FORMATTER_CACHE.delete(oldest.value);
  }
  PARTS_FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
}

/**
 * `hour12: false` does not guarantee a 0-23 clock. Pre-2021 ECMA-402 resolved
 * `hour12: false` to `h24` for any locale whose default hour cycle is `h12` —
 * en-US is one — and `h24` renders midnight as hour **24** on the same
 * calendar day rather than hour 0. Node/V8 implement the later normative
 * change (always `h23`), but this bundle does not run on V8: React Native
 * builds Intl on whatever ICU/Foundation the device ships, and we do not get
 * to pick which devices those are.
 *
 * Forcing `hourCycle: "h23"` is not the fix. The spec discards `hourCycle`
 * whenever `hour12` is also present, and dropping `hour12` on an engine
 * without `hourCycle` support falls back to a 12-hour clock, which is far
 * worse. So normalise the one value that can differ.
 *
 * Left unhandled, an h24 build reads local midnight as 24:00 and
 * `getOffsetMinutesAtInstant` returns an offset 1440 minutes (a full day) too
 * large, which pushes every session time for a meet in that timezone a day
 * off.
 */
function normalizeHour(hour: number): number {
  return hour === 24 ? 0 : hour;
}

function getZonedParts(timeZone: string, instant: Date): ZonedDateParts {
  const parts = getPartsFormatter(timeZone).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: normalizeHour(read("hour")),
    minute: read("minute"),
  };
}

function toUtcTimestamp(parts: ZonedDateParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0,
  );
}

function toComparableMinutes(parts: ZonedDateParts): number {
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0) / MS_PER_MINUTE +
    parts.hour * 60 +
    parts.minute
  );
}

export function parseClockTime(time: string): { hour: number; minute: number } {
  const input = time.trim();

  // Seconds are optional in both branches. The API emits `h:mm:ss AM/PM` for
  // some rows — `formatTo12Hour` in `data/meets/config.ts` has an explicit
  // "already 12-hour, just strip the seconds" branch for exactly that shape —
  // and rejecting it here made `formatApiTime` return "" (blank start time on
  // the schedule and start list) and made `lib/next-session` skip the session
  // outright, so the Next Session card went blank.
  const amPmMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i.exec(input);
  if (amPmMatch) {
    const rawHour = Number(amPmMatch[1]);
    const minute = Number(amPmMatch[2]);
    const period = amPmMatch[4].toUpperCase();

    if (rawHour < 1 || rawHour > 12 || minute < 0 || minute > 59) {
      throw new Error(`Invalid time: ${time}`);
    }

    let hour = rawHour % 12;
    if (period === "PM") hour += 12;
    return { hour, minute };
  }

  const twentyFourHourMatch =
    /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(input);
  if (twentyFourHourMatch) {
    return {
      hour: Number(twentyFourHourMatch[1]),
      minute: Number(twentyFourHourMatch[2]),
    };
  }

  throw new Error(`Invalid time: ${time}`);
}

export function getOffsetMinutesAtInstant(
  timeZone: string,
  instant: Date,
): number {
  const zonedParts = getZonedParts(timeZone, instant);
  return (toUtcTimestamp(zonedParts) - instant.getTime()) / MS_PER_MINUTE;
}

export function convertZonedLocalToUTC(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!dateMatch) {
    throw new Error(`Invalid date: ${date}`);
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  // `Date.UTC` normalises out-of-range parts (Feb 29 2026 -> Mar 1, month 00
  // -> the previous December), which would turn a malformed session date into
  // a real instant on another day. Day 0 of the next month is this month's
  // last day, which also gets leap years right.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error(`Invalid date: ${date}`);
  }
  const { hour, minute } = parseClockTime(time);

  const naiveUtcTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const desiredParts: ZonedDateParts = { year, month, day, hour, minute };

  const offsets = Array.from(
    new Set([
      getOffsetMinutesAtInstant(timeZone, new Date(naiveUtcTimestamp)),
      getOffsetMinutesAtInstant(
        timeZone,
        new Date(naiveUtcTimestamp - DST_PROBE_WINDOW_MS),
      ),
      getOffsetMinutesAtInstant(
        timeZone,
        new Date(naiveUtcTimestamp + DST_PROBE_WINDOW_MS),
      ),
    ]),
  );

  const candidateInstants = offsets.map(
    (offsetMinutes) => new Date(naiveUtcTimestamp - offsetMinutes * MS_PER_MINUTE),
  );

  const exactMatches = candidateInstants.filter((candidate) => {
    const parts = getZonedParts(timeZone, candidate);
    return (
      parts.year === desiredParts.year &&
      parts.month === desiredParts.month &&
      parts.day === desiredParts.day &&
      parts.hour === desiredParts.hour &&
      parts.minute === desiredParts.minute
    );
  });

  if (exactMatches.length > 0) {
    exactMatches.sort((a, b) => a.getTime() - b.getTime());
    return exactMatches[0];
  }

  const desiredMinutes = toComparableMinutes(desiredParts);
  const decorated = candidateInstants.map((candidate) => {
    const candidateParts = getZonedParts(timeZone, candidate);
    const diffMinutes = toComparableMinutes(candidateParts) - desiredMinutes;
    return { candidate, diffMinutes };
  });

  const futureCandidates = decorated
    .filter((item) => item.diffMinutes >= 0)
    .sort((a, b) => a.diffMinutes - b.diffMinutes);

  if (futureCandidates.length > 0) {
    return futureCandidates[0].candidate;
  }

  decorated.sort(
    (a, b) => Math.abs(a.diffMinutes) - Math.abs(b.diffMinutes),
  );
  return decorated[0].candidate;
}
