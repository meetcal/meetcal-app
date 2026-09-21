// Seconds are optional and the space before the period is too: the API emits
// both "9:00 AM" and "9:00:00 AM", and stored sessions can carry "9:00AM".
const TIME_12H_REGEX = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i;
const TIME_24H_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function parseTo24Hour(startTime: string): { hour24: number; minutes: number } | null {
  const trimmed = startTime.trim();
  const match12h = trimmed.match(TIME_12H_REGEX);
  if (match12h) {
    const hours = parseInt(match12h[1], 10);
    const minutes = parseInt(match12h[2], 10);
    const period = match12h[3].toUpperCase();

    if (hours < 1 || hours > 12) {
      console.warn("calculateWeighInTime: hours out of range 1-12", {
        startTime,
        hours,
      });
      return null;
    }
    if (minutes < 0 || minutes > 59) {
      console.warn("calculateWeighInTime: minutes out of range 0-59", {
        startTime,
        minutes,
      });
      return null;
    }
    if (period !== "AM" && period !== "PM") {
      console.warn("calculateWeighInTime: period must be AM or PM", {
        startTime,
        period,
      });
      return null;
    }

    let hour24 = hours;
    if (period === "PM" && hours !== 12) hour24 += 12;
    if (period === "AM" && hours === 12) hour24 = 0;

    return { hour24, minutes };
  }

  const match24h = trimmed.match(TIME_24H_REGEX);
  if (match24h) {
    return {
      hour24: parseInt(match24h[1], 10),
      minutes: parseInt(match24h[2], 10),
    };
  }

  return null;
}

// Saved sessions are auto-removed once this much time has elapsed since their start.
export const AUTO_UNSAVE_DELAY_MS = 2 * 60 * 60 * 1000;

/** USAW weigh-in opens this many hours before the session's start time. */
export const WEIGH_IN_LEAD_HOURS = 2;

/**
 * Returned when `startTime` cannot be parsed: an empty string, meaning "no
 * weigh-in time known".
 *
 * This used to be a hard-coded `"6:00 AM"`. Two call sites were guarded with
 * `startTime ? calculateWeighInTime(startTime) : ""`, but their siblings were
 * not — `saveSessionsFromAthletes`' schedule branch and the notification
 * payload in `saveSession`, plus `schedule-details` and `HeaderSection` — so a
 * session whose `start_time` is null in the API (`formatApiTime` maps that to
 * `""`) was *persisted* and pushed to the server carrying an invented 6am
 * weigh-in, and shipped in the reminder notification's deep-link params.
 *
 * Every consumer already renders a missing weigh-in as blank, because the two
 * guarded call sites have always been able to produce `""`. Failing to `""`
 * here makes the whole family honest at one point instead of at each caller.
 */
const WEIGH_IN_UNKNOWN = "";

/**
 * Returns true when a session started at least AUTO_UNSAVE_DELAY_MS (2 hours)
 * before `now`, meaning it qualifies for auto-removal.
 */
export function hasSessionPassedAutoUnsaveWindow(
  sessionStart: Date,
  now: Date = new Date(),
): boolean {
  const startMs = sessionStart.getTime();
  if (Number.isNaN(startMs)) return false;
  return now.getTime() - startMs >= AUTO_UNSAVE_DELAY_MS;
}

export function calculateWeighInTime(startTime: string): string {
  // A blank start time is an ordinary API state (`start_time: null`), not a
  // malformed one; only warn about values that are present but unparseable.
  if (!startTime || !startTime.trim()) return WEIGH_IN_UNKNOWN;

  const parsed = parseTo24Hour(startTime);
  if (!parsed) {
    console.warn(
      'calculateWeighInTime: invalid startTime format, expected "HH:MM AM/PM" or "HH:MM[:SS]"',
      { startTime },
    );
    return WEIGH_IN_UNKNOWN;
  }
  const { minutes } = parsed;
  const { hour24 } = parsed;

  let weighInHour = hour24 - WEIGH_IN_LEAD_HOURS;

  // Handle day wrap
  if (weighInHour < 0) weighInHour += 24;

  // Convert back to 12 hour format
  let weighInPeriod: "AM" | "PM" = "AM";
  if (weighInHour >= 12) {
    weighInPeriod = "PM";
    if (weighInHour > 12) weighInHour -= 12;
  }
  if (weighInHour === 0) weighInHour = 12;

  return `${weighInHour}:${minutes.toString().padStart(2, "0")} ${weighInPeriod}`;
} 
