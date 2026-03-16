type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
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
  PARTS_FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
}

function getZonedParts(timeZone: string, instant: Date): ZonedDateParts {
  const parts = getPartsFormatter(timeZone).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
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
    Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0) / 60000 +
    parts.hour * 60 +
    parts.minute
  );
}

export function parseClockTime(time: string): { hour: number; minute: number } {
  const input = time.trim();

  const amPmMatch = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(input);
  if (amPmMatch) {
    const rawHour = Number(amPmMatch[1]);
    const minute = Number(amPmMatch[2]);
    const period = amPmMatch[3].toUpperCase();

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
  return (toUtcTimestamp(zonedParts) - instant.getTime()) / 60000;
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
  const { hour, minute } = parseClockTime(time);

  const naiveUtcTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const desiredParts: ZonedDateParts = { year, month, day, hour, minute };

  const offsets = Array.from(
    new Set([
      getOffsetMinutesAtInstant(timeZone, new Date(naiveUtcTimestamp)),
      getOffsetMinutesAtInstant(
        timeZone,
        new Date(naiveUtcTimestamp - 12 * 60 * 60 * 1000),
      ),
      getOffsetMinutesAtInstant(
        timeZone,
        new Date(naiveUtcTimestamp + 12 * 60 * 60 * 1000),
      ),
    ]),
  );

  const candidateInstants = offsets.map(
    (offsetMinutes) => new Date(naiveUtcTimestamp - offsetMinutes * 60 * 1000),
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
