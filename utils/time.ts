const TIME_12H_REGEX = /^(\d{1,2}):(\d{2})\s+(AM|PM)$/i;
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

export function calculateWeighInTime(startTime: string): string {
  const parsed = parseTo24Hour(startTime);
  if (!parsed) {
    console.warn(
      'calculateWeighInTime: invalid startTime format, expected "HH:MM AM/PM" or "HH:MM[:SS]"',
      { startTime },
    );
    return "6:00 AM";
  }
  const { minutes } = parsed;
  let { hour24 } = parsed;

  // Subtract 2 hours
  let weighInHour = hour24 - 2;

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
