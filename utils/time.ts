const TIME_12H_REGEX = /^(\d{1,2}):(\d{2})\s+(AM|PM)$/i;

export function calculateWeighInTime(startTime: string): string {
  const match = startTime.trim().match(TIME_12H_REGEX);
  if (!match) {
    console.warn(
      'calculateWeighInTime: invalid startTime format, expected "HH:MM AM/PM"',
      { startTime },
    );
    return "6:00 AM";
  }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (hours < 1 || hours > 12) {
    console.warn("calculateWeighInTime: hours out of range 1-12", {
      startTime,
      hours,
    });
    return "6:00 AM";
  }
  if (minutes < 0 || minutes > 59) {
    console.warn("calculateWeighInTime: minutes out of range 0-59", {
      startTime,
      minutes,
    });
    return "6:00 AM";
  }
  if (period !== "AM" && period !== "PM") {
    console.warn("calculateWeighInTime: period must be AM or PM", {
      startTime,
      period,
    });
    return "6:00 AM";
  }

  // Convert to 24 hour format
  let hour24 = hours;
  if (period === "PM" && hours !== 12) hour24 += 12;
  if (period === "AM" && hours === 12) hour24 = 0;

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