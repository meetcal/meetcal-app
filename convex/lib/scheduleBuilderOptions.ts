import { v, type Infer } from 'convex/values';
import { isValidIsoDate, apiError } from './validation';
import { isoDaysAfter, pad2 } from './dates';

export const MAX_BUILDER_DAYS = 7;
export const MAX_BUILDER_PLATFORMS = 6;
export const MAX_PLATFORM_NAME_LENGTH = 30;
export const MAX_BUILDER_EDITS = 500;
export const WEIGH_IN_MINUTES = 120;
export const BUILDER_LIMITS = {
  sessionMinutes: { min: 15, max: 480 },
  breakMinutes: { min: 0, max: 240 },
  maxAthletesPerPlatform: { min: 1, max: 60 },
  maxSessionsPerDay: { min: 1, max: 30 },
} as const;

export const MINUTES_PER_DAY = 24 * 60;

export const DEFAULT_BUILDER_SETTINGS = {
  firstStart: '09:00',
  sessionMinutes: 120,
  breakMinutes: 0,
  maxAthletesPerPlatform: 15,
  platforms: ['Red'],
} as const;

export const builderGroupingValidator = v.union(v.literal('weightClass'), v.literal('entryTotal'));
export const builderOrderValidator = v.union(v.literal('womenThenMen'), v.literal('alternate'), v.literal('womenDayMenDay'));

export const builderOptionsValidator = v.object({
  days: v.array(v.object({ date: v.string(), firstStart: v.string() })),
  sessionMinutes: v.number(),
  breakMinutes: v.number(),
  maxAthletesPerPlatform: v.number(),
  maxSessionsPerDay: v.union(v.number(), v.null()),
  platforms: v.array(v.string()),
  grouping: builderGroupingValidator,
  separateAgeGroups: v.boolean(),
  order: builderOrderValidator,
});

export const builderEditValidator = v.union(
  v.object({
    kind: v.literal('moveAthlete'),
    athlete: v.string(),
    fromSession: v.optional(v.number()),
    fromPlatform: v.optional(v.string()),
    occurrence: v.optional(v.number()),
    toSession: v.number(),
    toPlatform: v.string(),
  }),
  v.object({
    kind: v.literal('moveClass'),
    fromSession: v.number(),
    fromPlatform: v.string(),
    weightClass: v.string(),
    toSession: v.number(),
    toPlatform: v.string(),
  }),
  v.object({ kind: v.literal('swapSessions'), session: v.number(), withSession: v.number() }),
  v.object({ kind: v.literal('setSessionTime'), session: v.number(), date: v.string(), startTime: v.string() }),
);

export type BuilderOptions = Infer<typeof builderOptionsValidator>;
export type BuilderEdit = Infer<typeof builderEditValidator>;
export type BuilderOrder = BuilderOptions['order'];

export function minutesOfClock(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function storedClockOf(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}:00`;
}

export function clockLabel(stored: string): string {
  const minutes = minutesOfClock(stored.slice(0, 5));
  if (minutes === null) return '';
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad2(minutes % 60)} ${hour < 12 ? 'AM' : 'PM'}`;
}

function requireWhole(field: keyof typeof BUILDER_LIMITS, value: number): void {
  const { min, max } = BUILDER_LIMITS[field];
  if (!Number.isInteger(value) || value < min || value > max) {
    throw apiError(400, `${field} must be a whole number from ${min} to ${max}`);
  }
}

export function checkBuilderOptions(options: BuilderOptions): void {
  if (options.days.length === 0 || options.days.length > MAX_BUILDER_DAYS) {
    throw apiError(400, `days must list 1 to ${MAX_BUILDER_DAYS} meet days`, { max: MAX_BUILDER_DAYS });
  }
  requireWhole('sessionMinutes', options.sessionMinutes);
  requireWhole('breakMinutes', options.breakMinutes);
  requireWhole('maxAthletesPerPlatform', options.maxAthletesPerPlatform);
  if (options.maxSessionsPerDay !== null) requireWhole('maxSessionsPerDay', options.maxSessionsPerDay);
  const dates = new Set<string>();
  for (const day of options.days) {
    if (!isValidIsoDate(day.date)) throw apiError(400, `day ${JSON.stringify(day.date)} is not a YYYY-MM-DD date`);
    if (dates.has(day.date)) throw apiError(400, `day ${day.date} is listed twice`);
    if ([...dates].some((earlier) => earlier > day.date)) throw apiError(400, 'days must be listed in date order');
    dates.add(day.date);
    const start = minutesOfClock(day.firstStart);
    if (start === null) throw apiError(400, `the first start on ${day.date} is not an HH:MM time`);
    if (start < WEIGH_IN_MINUTES) throw apiError(400, `the first start on ${day.date} leaves no time for its weigh-in`);
    if (start + options.sessionMinutes > MINUTES_PER_DAY) throw apiError(400, `the first session on ${day.date} would end after midnight`);
  }
  if (options.platforms.length === 0 || options.platforms.length > MAX_BUILDER_PLATFORMS) {
    throw apiError(400, `platforms must name 1 to ${MAX_BUILDER_PLATFORMS} platforms`, { max: MAX_BUILDER_PLATFORMS });
  }
  const names = new Set<string>();
  for (const platform of options.platforms) {
    const name = platform.trim();
    if (name === '' || name.length > MAX_PLATFORM_NAME_LENGTH) throw apiError(400, `a platform name must be 1 to ${MAX_PLATFORM_NAME_LENGTH} characters`);
    if (name !== platform) throw apiError(400, `the platform name ${JSON.stringify(platform)} has spaces around it`);
    if (names.has(name.toLowerCase())) throw apiError(400, `the platform ${JSON.stringify(name)} is listed twice`);
    names.add(name.toLowerCase());
  }
}

export function checkBuilderEdits(edits: readonly BuilderEdit[]): void {
  if (edits.length > MAX_BUILDER_EDITS) throw apiError(400, `at most ${MAX_BUILDER_EDITS} edits`, { max: MAX_BUILDER_EDITS });
  for (const edit of edits) {
    if (edit.kind === 'setSessionTime' && (!isValidIsoDate(edit.date) || minutesOfClock(edit.startTime) === null)) {
      throw apiError(400, 'a session time edit needs a YYYY-MM-DD date and an HH:MM start');
    }
  }
}

export function meetDays(startDate: string, endDate: string): string[] {
  if (!isValidIsoDate(startDate)) return [];
  const last = isValidIsoDate(endDate) && endDate >= startDate ? endDate : startDate;
  const days: string[] = [];
  for (let day = startDate; day <= last && days.length < MAX_BUILDER_DAYS; day = isoDaysAfter(day, 1)) days.push(day);
  return days;
}

export function defaultBuilderOptions(meet: { startDate: string; endDate: string }): BuilderOptions {
  return {
    days: meetDays(meet.startDate, meet.endDate).map((date) => ({ date, firstStart: DEFAULT_BUILDER_SETTINGS.firstStart })),
    sessionMinutes: DEFAULT_BUILDER_SETTINGS.sessionMinutes,
    breakMinutes: DEFAULT_BUILDER_SETTINGS.breakMinutes,
    maxAthletesPerPlatform: DEFAULT_BUILDER_SETTINGS.maxAthletesPerPlatform,
    maxSessionsPerDay: null,
    platforms: [...DEFAULT_BUILDER_SETTINGS.platforms],
    grouping: 'weightClass',
    separateAgeGroups: true,
    order: 'womenThenMen',
  };
}
