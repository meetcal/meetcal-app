/**
 * The schedules `cronJobs.ts` uses: five-field UTC crontab lines whose minute
 * is a number and whose hour is a number or `*` (daily and hourly jobs), the
 * other fields `*`. Anything else is rejected, so a new kind of schedule
 * gets a real implementation here rather than a wrong answer.
 */
export function parseSchedule(schedule: string): { minute: number; hour: number | null } {
  const fields = schedule.trim().split(/\s+/);
  const [minute, hour, ...rest] = fields;
  if (fields.length !== 5 || rest.some((field) => field !== '*') || !/^\d{1,2}$/.test(minute) || !(hour === '*' || /^\d{1,2}$/.test(hour))) {
    throw new Error(`unsupported schedule "${schedule}": only "M H * * *" and "M * * * *" are handled`);
  }
  const m = Number(minute);
  const h = hour === '*' ? null : Number(hour);
  if (m > 59 || (h !== null && h > 23)) throw new Error(`out-of-range schedule "${schedule}"`);
  return { minute: m, hour: h };
}

/** The latest time at or before `now` (ms) the schedule fired. */
export function lastScheduled(schedule: string, now: number): number {
  const { minute, hour } = parseSchedule(schedule);
  const at = new Date(now);
  at.setUTCSeconds(0, 0);
  at.setUTCMinutes(minute);
  if (hour === null) {
    if (at.getTime() > now) at.setUTCHours(at.getUTCHours() - 1);
  } else {
    at.setUTCHours(hour);
    if (at.getTime() > now) at.setUTCDate(at.getUTCDate() - 1);
  }
  return at.getTime();
}
