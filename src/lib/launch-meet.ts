import type { Meet } from '@/data/types/meet';
import {
  getAnywhereOnEarthDate,
  getCalendarDateInTimeZone,
  toMeetCalendarDate,
} from '@/utils/dateTime';
import { resolvedMeetTimeZone } from '@/utils/timezone';
import { stableSerialize } from '@/lib/data/mutable-resource';
import { parseStoredMeetNamed } from '@/lib/stored-meet';

type CompletionSource = Pick<Meet, 'status' | 'dates' | 'time' | 'timeZoneUnknown'>;

/**
 * Whether a meet is over at `now`: the server says so, or its last day has
 * passed on its own calendar (`meetStatusAt` in `convex/lib/meetStatus.ts`,
 * the rule the server's status comes from). The date check covers a copy
 * whose status was fetched before the meet ended: the cached `/meets` list,
 * or details persisted for an offline start. A meet with no known zone is
 * read on the last calendar on Earth (UTC-12), so it is never over early.
 */
export function isMeetCompleted(meet: CompletionSource, now: Date): boolean {
  if (meet.status === 'completed') return true;
  const end = toMeetCalendarDate(meet.dates?.end) || toMeetCalendarDate(meet.dates?.start);
  if (!end) return false;
  const zone = resolvedMeetTimeZone(meet);
  const today = zone ? getCalendarDateInTimeZone(zone, now) : getAnywhereOnEarthDate(now);
  return end < today;
}

/**
 * The meet to open the app on: the stored (last selected) meet while it is
 * not over, else the first meet in `meets` that is not over. `meets` is the
 * `/meets` list, soonest first, as the meet picker shows it. When every meet
 * is over (a stale cache offline) the stored meet, then the first, still
 * beats an empty schedule.
 */
export function chooseLaunchMeet(
  meets: readonly Meet[],
  stored: string | null,
  now: Date,
): Meet | null {
  const storedMeet = stored ? meets.find((meet) => meet.name === stored) : undefined;
  if (storedMeet && !isMeetCompleted(storedMeet, now)) return storedMeet;
  return meets.find((meet) => !isMeetCompleted(meet, now)) ?? storedMeet ?? meets[0] ?? null;
}

export function refreshedMeetDetails(
  current: Meet | null,
  freshMeets: readonly Meet[],
): Meet | null {
  if (!current) return null;
  const fresh = freshMeets.find((meet) => meet.name === current.name);
  if (!fresh || stableSerialize(fresh) === stableSerialize(current)) return null;
  return fresh;
}

export type LaunchDecision = {
  select: Meet | null;
  persistDetails: Meet | null;
  clearStored: boolean;
};

const KEEP_EVERYTHING: LaunchDecision = { select: null, persistDetails: null, clearStored: false };

export type CachedListDecision = LaunchDecision & {
  paintCachedList: boolean;
  lookUpStoredMeet: boolean;
  resolving: boolean;
  activeMeet: string | null;
};

export function decideFromCachedList(input: {
  cachedMeets: readonly Meet[];
  stored: string | null;
  selectedMeet: string | null;
  now: Date;
}): CachedListDecision {
  const { cachedMeets, stored, selectedMeet } = input;
  const paintCachedList = cachedMeets.length > 0;
  const lookUpStoredMeet =
    !selectedMeet && !!stored && !cachedMeets.some((meet) => meet.name === stored);
  const waiting = {
    ...KEEP_EVERYTHING,
    paintCachedList,
    lookUpStoredMeet,
    resolving: paintCachedList && lookUpStoredMeet,
    activeMeet: selectedMeet,
  };
  if (!paintCachedList || lookUpStoredMeet) return waiting;
  const choice = selectedMeet
    ? cachedMeets.find((meet) => meet.name === selectedMeet) ?? null
    : chooseLaunchMeet(cachedMeets, stored, input.now);
  return {
    ...waiting,
    select: selectedMeet ? null : choice,
    activeMeet: choice?.name ?? selectedMeet,
  };
}

export type StoredMeetLookupDecision = LaunchDecision & { keepsStoredMeet: boolean };

export function decideAfterStoredMeetLookup(input: {
  stored: string;
  found: Meet | null;
  lookupFailed: boolean;
  cachedMeets: readonly Meet[];
  now: Date;
}): StoredMeetLookupDecision {
  const { found, lookupFailed, cachedMeets, now } = input;
  const passedOver =
    found !== null &&
    isMeetCompleted(found, now) &&
    (!lookupFailed || cachedMeets.some((meet) => !isMeetCompleted(meet, now)));
  if (found && !passedOver) {
    return { select: found, persistDetails: found, clearStored: false, keepsStoredMeet: true };
  }
  return {
    select: chooseLaunchMeet(cachedMeets, lookupFailed ? input.stored : null, now),
    persistDetails: null,
    clearStored: !lookupFailed,
    keepsStoredMeet: false,
  };
}

export type FreshListDecision =
  | { kind: 'noMeets' }
  | { kind: 'keepSelection' }
  | { kind: 'lookUpActiveMeet'; meet: string }
  | ({ kind: 'listed'; refreshShownDetails: boolean } & LaunchDecision);

export function decideAfterFreshList(input: {
  freshMeets: readonly Meet[];
  activeMeet: string | null;
  selectedMeet: string | null;
  shownMeetName: string | null;
  keepsStoredMeet: boolean;
  choseFromCache: boolean;
  stored: string | null;
  storedDetailsRaw: string | null;
  now: Date;
}): FreshListDecision {
  const { freshMeets, activeMeet } = input;
  if (freshMeets.length === 0) return { kind: 'noMeets' };
  const listed = activeMeet ? freshMeets.find((meet) => meet.name === activeMeet) ?? null : null;
  if (activeMeet && !listed) {
    if (input.keepsStoredMeet) return { kind: 'keepSelection' };
    if (activeMeet === input.selectedMeet && input.shownMeetName === activeMeet) {
      return { kind: 'keepSelection' };
    }
    return { kind: 'lookUpActiveMeet', meet: activeMeet };
  }
  if (listed) {
    const persisted = parseStoredMeetNamed(input.storedDetailsRaw, listed.name);
    const persistDetails = persisted && refreshedMeetDetails(persisted, [listed]) ? listed : null;
    return { kind: 'listed', refreshShownDetails: true, ...KEEP_EVERYTHING, persistDetails };
  }
  return {
    kind: 'listed',
    refreshShownDetails: false,
    ...KEEP_EVERYTHING,
    select: input.choseFromCache ? null : chooseLaunchMeet(freshMeets, input.stored, input.now),
  };
}

export function decideAfterActiveMeetLookup(input: {
  found: Meet | null;
  selectedMeet: string | null;
  freshMeets: readonly Meet[];
  now: Date;
}): LaunchDecision {
  const { found } = input;
  const kept = found && (input.selectedMeet || !isMeetCompleted(found, input.now)) ? found : null;
  if (kept) return { select: kept, persistDetails: kept, clearStored: false };
  return {
    select: chooseLaunchMeet(input.freshMeets, null, input.now),
    persistDetails: null,
    clearStored: true,
  };
}
