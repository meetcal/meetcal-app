import type { Schedule } from '@/types/schedule';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function isAddressableSession(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonEmptyText(value.id) &&
    typeof value.number === 'number' &&
    Number.isFinite(value.number) &&
    value.number !== 0 &&
    Array.isArray(value.platforms) &&
    value.platforms.every((platform) => isObject(platform) && typeof platform.platform === 'string')
  );
}

export function scheduleShapeProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'Invalid schedule format';
  for (const [dayIndex, day] of value.entries()) {
    if (!isObject(day) || !isNonEmptyText(day.date) || !isNonEmptyText(day.fullDate) || !Array.isArray(day.sessions)) {
      return `Invalid day structure at index ${dayIndex}`;
    }
    const badSession = day.sessions.findIndex((session) => !isAddressableSession(session));
    if (badSession !== -1) {
      return `Invalid session structure at day ${dayIndex}, session ${badSession}`;
    }
  }
  return null;
}

export function isSchedule(value: unknown): value is Schedule {
  return scheduleShapeProblem(value) === null;
}
