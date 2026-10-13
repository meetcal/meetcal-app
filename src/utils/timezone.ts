type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/**
 * Formatters kept per zone id. Mirrors `ABBREVIATION_FORMATTER_CACHE_LIMIT`
 * below: a meet list spans a handful of zones, and the bound
 * keeps odd spellings of the same zone from accumulating for the process life.
 */
export const PARTS_FORMATTER_CACHE_LIMIT = 32;
/**
 * Half-width of the window probed for a DST transition around a wall-clock
 * time. The instant a wall time names is within 14 hours (the widest UTC
 * offset, +14:00) of the same digits read as UTC, so probing that far finds
 * the offset on both sides of any transition that can affect it. Twelve hours
 * covered every US zone but missed the offset in force before a change in a
 * zone ahead of UTC+12 (Auckland and Chatham daylight time): a real Chatham
 * time resolved an hour early, and an Auckland spring-forward gap moved back.
 */
const DST_PROBE_WINDOW_MS = 14 * 60 * 60 * 1000;
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

/**
 * Whether `timeZone` is a zone this device's `Intl` can format in: any IANA
 * zone the platform's time zone database knows (Hermes reads it from
 * Foundation's `NSTimeZone` on iOS and ICU's `TimeZone` on Android), not only
 * the US ones. A non-string, blank or unknown id (`""`, `"__proto__"`) is not.
 *
 * The API mapper checks a meet's zone with it, and so do persisted rows whose
 * zone a screen hands straight to `toLocale*String`, which throws a
 * `RangeError` mid-render for an id `Intl` does not know. Builds (and caches)
 * the formatter the conversions below would use anyway.
 */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string") return false;
  try {
    getPartsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
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
    const second = Number(amPmMatch[3] ?? "0");
    const period = amPmMatch[4].toUpperCase();

    // Seconds are range-checked as in the 24-hour branch, which rejects
    // "13:00:99"; "1:00:99 PM" used to be the one shape that slipped through.
    if (rawHour < 1 || rawHour > 12 || minute < 0 || minute > 59 || second > 59) {
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
  // The parts stop at the minute, so compare them with the instant's minute:
  // 12:00:30Z in UTC would otherwise come out as an offset of -0.5.
  const minuteStart =
    Math.floor(instant.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
  return (toUtcTimestamp(zonedParts) - minuteStart) / MS_PER_MINUTE;
}

/**
 * A real `YYYY-MM-DD` calendar day, or null (a placeholder such as `TBD`,
 * or a day that does not exist). The date rule `convertZonedLocalToUTC`
 * applies, for callers that must skip what it would reject.
 */
export function parseMeetCalendarDay(
  date: string,
): { year: number; month: number; day: number } | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!dateMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  // `Date.UTC` normalises out-of-range parts (Feb 29 2026 -> Mar 1, month 00
  // -> the previous December), which would turn a malformed session date into
  // a real instant on another day. Day 0 of the next month is this month's
  // last day, which also gets leap years right.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  return { year, month, day };
}

export function convertZonedLocalToUTC(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const calendarDay = parseMeetCalendarDay(date);
  if (!calendarDay) {
    throw new Error(`Invalid date: ${date}`);
  }
  const { year, month, day } = calendarDay;
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

/**
 * How many timezone formatters stay resident. Meets span a handful of zones,
 * so this never fills in practice; it is the bound that keeps a malformed
 * feed from growing the map without limit.
 */
const ABBREVIATION_FORMATTER_CACHE_LIMIT = 32;

/**
 * `new Intl.DateTimeFormat(...)` costs roughly ten times a `formatToParts`
 * call on an existing instance, and `mapApiMeet` builds two per meet for the
 * whole `/meets` list on every app start, every five-minute refresh and every
 * reconnect. A formatter carries no per-call state, so one instance per zone
 * is reused across instants — the abbreviation still varies with `instant`
 * (EST vs EDT), because that is decided by `formatToParts`, not by the
 * constructor.
 */
const abbreviationFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getAbbreviationFormatter(timeZoneIdentifier: string): Intl.DateTimeFormat {
  const cached = abbreviationFormatterCache.get(timeZoneIdentifier);
  if (cached) return cached;

  // Throws for an unknown identifier. Deliberately not cached: the caller
  // turns it into "Local" and a later valid id must still be able to resolve.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZoneIdentifier,
    timeZoneName: "short",
  });

  // Insertion-ordered eviction: `Map` keys iterate oldest-first.
  while (abbreviationFormatterCache.size >= ABBREVIATION_FORMATTER_CACHE_LIMIT) {
    const oldest = abbreviationFormatterCache.keys().next();
    if (oldest.done) break;
    abbreviationFormatterCache.delete(oldest.value);
  }
  abbreviationFormatterCache.set(timeZoneIdentifier, formatter);
  return formatter;
}

/** A zone name made of letters only ("EDT", "HST", "GMT", "UTC"). */
const LETTER_ZONE_NAME = /^[A-Z]{2,5}$/;

/**
 * "GMT+9", "GMT+5:30", "GMT-3" or "GMT" for an offset east of UTC in minutes.
 * The en-US short name of most zones outside North America is already this
 * shape, but engines spell it differently (V8 "GMT+5:30", others "GMT+05:30"
 * or "UTC+5:30"), so the app builds it from the offset itself.
 */
export function formatGmtOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "GMT";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const minutes = Math.abs(offsetMinutes) % 60;
  return `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

/**
 * The label shown after a meet-local time: the zone's en-US short name when
 * it has a lettered one (US zones: "EDT", "MST", "HST"; also "GMT", "UTC"),
 * otherwise its offset at `instant` ("GMT+9" for Tokyo, "GMT+5:30" for
 * Kolkata, "GMT+11" for Sydney in January). Either way it is read at
 * `instant`, so daylight time is the one in force then.
 * @param timeZoneIdentifier - IANA timezone identifier (e.g., "America/New_York")
 * @returns The label, or "Local" when the zone is not one the device knows
 */
export function getTimeZoneAbbreviation(
  timeZoneIdentifier: string,
  instant: Date = new Date(),
): string {
  try {
    const name = getAbbreviationFormatter(timeZoneIdentifier)
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value;
    if (name && LETTER_ZONE_NAME.test(name)) return name;
    return formatGmtOffset(getOffsetMinutesAtInstant(timeZoneIdentifier, instant));
  } catch {
    return "Local";
  }
}

/** The meet-zone fields `meetTimeZoneLabel` reads (`MeetConfig['time']`). */
export interface MeetZone {
  timeZoneIdentifier: string;
  /** The label at the meet's start date, used when a session has no date. */
  abbreviation: string;
}

/**
 * Wall clock a session date's label is read at: noon, clear of every DST
 * change (they happen overnight), as `mapApiMeet` reads the meet's own.
 */
const ZONE_LABEL_PROBE_TIME = "12:00";
/** Labels kept per zone and date; a meet spans a few days in one zone. */
export const ZONE_LABEL_CACHE_LIMIT = 64;
const zoneLabelCache = new Map<string, string>();

/**
 * The zone label ("EDT", "GMT+9") for a meet-local time on the meet calendar
 * date `dateYmd` (`YYYY-MM-DD`), read at that date in the meet's zone.
 *
 * `meet.abbreviation` is read once, at the meet's start date, so a meet that
 * spans a daylight-saving change labelled every day with the first day's
 * zone: a New York meet from Oct 30 to Nov 2 read "9:00 AM EDT" on Nov 1 and
 * 2, which are EST. Every screen that labels a session time, and the calendar
 * event notes, go through this instead.
 *
 * "" without a meet (no label beats a confidently wrong one); the start-date
 * label when `dateYmd` is not a calendar date.
 */
export function meetTimeZoneLabel(
  meet: MeetZone | null | undefined,
  dateYmd: string | null | undefined,
): string {
  if (!meet) return "";
  const datePart = typeof dateYmd === "string" ? dateYmd.trim().split("T")[0] : "";
  if (!datePart) return meet.abbreviation;
  const key = `${meet.timeZoneIdentifier}|${datePart}`;
  const cached = zoneLabelCache.get(key);
  if (cached !== undefined) return cached;

  let label: string;
  try {
    const noon = convertZonedLocalToUTC(datePart, ZONE_LABEL_PROBE_TIME, meet.timeZoneIdentifier);
    label = getTimeZoneAbbreviation(meet.timeZoneIdentifier, noon);
  } catch {
    // Not a calendar date, or not a zone this device knows.
    return meet.abbreviation;
  }
  // Insertion-ordered eviction: `Map` keys iterate oldest-first.
  while (zoneLabelCache.size >= ZONE_LABEL_CACHE_LIMIT) {
    const oldest = zoneLabelCache.keys().next();
    if (oldest.done) break;
    zoneLabelCache.delete(oldest.value);
  }
  zoneLabelCache.set(key, label);
  return label;
}

/** The parts of a meet (or `MeetConfig`) that say which zone its times are in. */
export interface MeetTimeZoneSource {
  time?: { timeZone?: string; timeZoneIdentifier?: string } | null;
  /** Set by the API mapper when `timeZoneIdentifier` is its fallback, not the meet's zone. */
  timeZoneUnknown?: boolean;
}

/**
 * The zone to compute a meet's instants in, or `null` when the meet has no
 * known zone.
 *
 * The API mapper turns a blank or unreadable zone into `America/New_York` so
 * screens can still render times, and flags it (`timeZoneUnknown`). Anything
 * that turns a meet-local time into an instant (the auto-unsave prune, the
 * session reminders, the widget's `start_at_ms`, the calendar event) must not
 * use that fallback: a Los Angeles meet read as New York was pruned, reminded
 * and hidden three hours early. A blank raw zone counts as unknown too, for a
 * meet cached before the flag was carried.
 */
export function resolvedMeetTimeZone(meet: MeetTimeZoneSource | null | undefined): string | null {
  if (!meet?.time || meet.timeZoneUnknown === true) return null;
  const { timeZone, timeZoneIdentifier } = meet.time;
  if (typeof timeZone === "string" && timeZone.trim() === "") return null;
  return isValidTimeZone(timeZoneIdentifier) ? timeZoneIdentifier : null;
}
