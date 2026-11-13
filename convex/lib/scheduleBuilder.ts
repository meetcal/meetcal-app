import { chunks } from './concurrency';
import { groupOfAge } from './elite';
import { athleteGenderLabel, normalizeGender } from './normalize';
import { normalizeName } from './names';
import { hasNoMemberId } from './memberIds';
import { foldedNameAndGender, hasSession } from './roster';
import { platformLabel } from './schedulePublishing';
import { compareBytes, compareCollated, sortByWeightClass } from './sort';
import { bareWeightClass } from './weightClass';
import {
  BUILDER_LIMITS,
  MAX_BUILDER_DAYS,
  MAX_BUILDER_PLATFORMS,
  MINUTES_PER_DAY,
  WEIGH_IN_MINUTES,
  defaultBuilderOptions,
  minutesOfClock,
  minutesOfStoredClock,
  storedClockOf,
  type BuilderEdit,
  type BuilderOptions,
  type BuilderOrder,
} from './scheduleBuilderOptions';

export type BuilderEntrant = {
  memberId: string;
  name: string;
  age: number;
  club: string;
  gender: string;
  weightClass: string;
  entryTotal: number;
  rosterId?: string;
};

export type AgePool = 'youth' | 'open' | 'masters' | '';

export type BuiltAthlete = BuilderEntrant & { key: string; withdrawn?: true };

export type RowTimes = { date: string; startTime: string; weighInTime: string };

export type PublishedPart = RowTimes & { weightClass: string };

export type BuiltGroup = {
  platform: string;
  gender: string;
  ageGroup: AgePool;
  split: string;
  weightClasses: string[];
  athletes: BuiltAthlete[];
  times?: RowTimes;
  publishedRows?: PublishedPart[];
};

export type BuiltSession = {
  id: number;
  number: number;
  date: string;
  startTime: string;
  weighInTime: string;
  groups: BuiltGroup[];
};

export type BuilderWarningCode = 'noEntrants' | 'unscheduled' | 'overCapacity' | 'mixedGroup' | 'overlap' | 'skippedEdit';

export type BuilderWarning = { code: BuilderWarningCode; message: string };

export type BuiltSchedule = { athletes: number; sessions: BuiltSession[]; warnings: BuilderWarning[] };

type Group = { gender: string; ageGroup: AgePool; split: string; splitOf: string; athletes: BuiltAthlete[]; edited: boolean; published?: { slot: number; rows: PublishedPart[] } };

type Slot = { id: number; date: string; start: number | null; groups: Map<string, Group>; published?: Map<string, PublishedPart[]>; retimed?: boolean };

function earliest<Times extends RowTimes>(times: readonly Times[]): Times | undefined {
  const startOf = (t: RowTimes) => minutesOfStoredClock(t.startTime) ?? MINUTES_PER_DAY;
  return times.reduce<Times | undefined>((first, t) => (first === undefined || compareBytes(t.date, first.date) < 0 || (t.date === first.date && startOf(t) < startOf(first)) ? t : first), undefined);
}

const timesOfPart = ({ date, startTime, weighInTime }: RowTimes): RowTimes => ({ date, startTime, weighInTime });

const GENDER_ORDER = ['Women', 'Men'];
const POOL_ORDER: readonly AgePool[] = ['youth', '', 'open', 'masters'];

export function athleteKeyOf(memberId: string, foldedName: string): string {
  return `${memberId}|${foldedName}`;
}

export function athleteKey(entrant: Pick<BuilderEntrant, 'memberId' | 'name'>): string {
  return athleteKeyOf(entrant.memberId, normalizeName(entrant.name));
}

export function ageGroupOf(age: number, separate: boolean): AgePool {
  if (!separate) return '';
  const group = groupOfAge(age);
  if (group === 'youth' || group === 'masters') return group;
  return 'open';
}

function builtAthleteOf(entrant: BuilderEntrant): BuiltAthlete {
  const { memberId, name, age, club, gender, weightClass, entryTotal, rosterId } = entrant;
  const built = { memberId, name, age, club, gender: normalizeGender(gender), weightClass: bareWeightClass(weightClass), entryTotal, key: athleteKey(entrant) };
  return rosterId === undefined ? built : { ...built, rosterId };
}

const byTotal = (a: BuiltAthlete, b: BuiltAthlete) => a.entryTotal - b.entryTotal || compareCollated(a.name, b.name) || compareBytes(a.key, b.key);

function genderRank(gender: string): number {
  const at = GENDER_ORDER.indexOf(gender);
  return at === -1 ? GENDER_ORDER.length : at;
}

export function balancedChunks<T>(items: readonly T[], max: number): T[][] {
  if (items.length === 0) return [];
  const count = Math.ceil(items.length / max);
  const base = Math.floor(items.length / count);
  const larger = items.length % count;
  const chunks: T[][] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i >= count - larger ? 1 : 0);
    chunks.push(items.slice(at, at + size));
    at += size;
  }
  return chunks;
}

export function splitLabel(index: number, count: number): string {
  if (count <= 1) return '';
  return String.fromCharCode('A'.charCodeAt(0) + (count - 1 - index));
}

function groupsByWeightClass(athletes: BuiltAthlete[], max: number, gender: string, ageGroup: AgePool): Group[] {
  const classes = sortByWeightClass([...new Set(athletes.map((a) => a.weightClass))], (c) => c);
  const groups: Group[] = [];
  let open: Group | null = null;
  for (const weightClass of classes) {
    const lifters = athletes.filter((a) => a.weightClass === weightClass).sort(byTotal);
    if (lifters.length > max) {
      const chunks = balancedChunks(lifters, max);
      chunks.forEach((chunk, i) => groups.push({ gender, ageGroup, split: splitLabel(i, chunks.length), splitOf: `${gender}|${ageGroup}|${weightClass}`, athletes: chunk, edited: false }));
      open = null;
      continue;
    }
    if (open && open.athletes.length + lifters.length <= max) {
      open.athletes.push(...lifters);
      continue;
    }
    open = { gender, ageGroup, split: '', splitOf: '', athletes: [...lifters], edited: false };
    groups.push(open);
  }
  return groups;
}

function groupsByEntryTotal(athletes: BuiltAthlete[], max: number, gender: string, ageGroup: AgePool): Group[] {
  return balancedChunks([...athletes].sort(byTotal), max).map((chunk) => ({ gender, ageGroup, split: '', splitOf: '', athletes: chunk, edited: false }));
}

function genderSequences(entrants: readonly BuilderEntrant[], options: BuilderOptions): Group[][] {
  const pools = new Map<string, { gender: string; ageGroup: AgePool; athletes: BuiltAthlete[] }>();
  for (const entrant of entrants) {
    const gender = normalizeGender(entrant.gender);
    const ageGroup = ageGroupOf(entrant.age, options.separateAgeGroups);
    const id = `${gender}|${ageGroup}`;
    const pool = pools.get(id) ?? { gender, ageGroup, athletes: [] };
    pool.athletes.push(builtAthleteOf(entrant));
    pools.set(id, pool);
  }
  const ordered = [...pools.values()].sort(
    (a, b) => genderRank(a.gender) - genderRank(b.gender) || compareBytes(a.gender, b.gender) || POOL_ORDER.indexOf(a.ageGroup) - POOL_ORDER.indexOf(b.ageGroup),
  );
  const sequences = new Map<string, Group[]>();
  for (const pool of ordered) {
    const groups =
      options.grouping === 'weightClass'
        ? groupsByWeightClass(pool.athletes, options.maxAthletesPerPlatform, pool.gender, pool.ageGroup)
        : groupsByEntryTotal(pool.athletes, options.maxAthletesPerPlatform, pool.gender, pool.ageGroup);
    sequences.set(pool.gender, [...(sequences.get(pool.gender) ?? []), ...groups]);
  }
  return [...sequences.values()];
}

export function interleave<T>(lists: readonly T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

function segmentsFor(order: BuilderOrder, sequences: Group[][]): Group[][] {
  if (order === 'alternate') return [interleave(sequences)];
  if (order === 'womenDayMenDay') return sequences.filter((s) => s.length > 0);
  return [sequences.flat()];
}

export function slotsThatFit(firstStart: number, options: Pick<BuilderOptions, 'sessionMinutes' | 'breakMinutes'>): number {
  const last = MINUTES_PER_DAY - options.sessionMinutes;
  if (firstStart > last) return 0;
  return Math.floor((last - firstStart) / (options.sessionMinutes + options.breakMinutes)) + 1;
}

export type Placement = { day: number; index: number } | null;

function placeSlots(segmentSlots: readonly number[], capacityOfDay: (day: number) => number, dayCount: number): Placement[] {
  const placements: Placement[] = [];
  let day = 0;
  let used = 0;
  segmentSlots.forEach((slots, segment) => {
    if (segment > 0 && used > 0) {
      day++;
      used = 0;
    }
    for (let i = 0; i < slots; i++) {
      while (day < dayCount && used >= capacityOfDay(day)) {
        day++;
        used = 0;
      }
      if (day >= dayCount) {
        placements.push(null);
        continue;
      }
      placements.push({ day, index: used });
      used++;
    }
  });
  return placements;
}

export function layoutSlots(segmentSlots: readonly number[], options: BuilderOptions): Placement[] {
  const fits = options.days.map((day) => slotsThatFit(minutesOfClock(day.firstStart) ?? 0, options));
  const total = segmentSlots.reduce((sum, n) => sum + n, 0);
  if (options.maxSessionsPerDay !== null) {
    const cap = options.maxSessionsPerDay;
    return placeSlots(segmentSlots, (day) => Math.min(cap, fits[day] ?? 0), options.days.length);
  }
  const placeWithCap = (cap: number) => placeSlots(segmentSlots, (day) => Math.min(cap, fits[day] ?? 0), options.days.length);
  const placesAll = (placements: readonly Placement[]) => placements.every((p) => p !== null);
  let low = Math.max(1, Math.ceil(total / options.days.length));
  let high = Math.max(low, ...fits);
  const widest = placeWithCap(high);
  if (!placesAll(widest)) return widest;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (placesAll(placeWithCap(middle))) high = middle;
    else low = middle + 1;
  }
  return placeWithCap(low);
}

function initialSlots(entrants: readonly BuilderEntrant[], options: BuilderOptions): Slot[] {
  const platforms = options.platforms;
  const segments = segmentsFor(options.order, genderSequences(entrants, options));
  const slotGroups = segments.map((groups) => chunks(groups, platforms.length));
  const placements = layoutSlots(
    slotGroups.map((slots) => slots.length),
    options,
  );
  const slots: Slot[] = [];
  slotGroups.flat().forEach((groups, i) => {
    const placement = placements[i] ?? null;
    const day = placement === null ? undefined : options.days[placement.day];
    const start = placement === null || !day ? null : (minutesOfClock(day.firstStart) ?? 0) + placement.index * (options.sessionMinutes + options.breakMinutes);
    slots.push({
      id: i + 1,
      date: day?.date ?? '',
      start,
      groups: new Map(groups.map((group, p) => [platforms[p] ?? '', group])),
    });
  });
  return slots;
}

type EditOutcome = 'applied' | 'skipped';

type AthleteAt = Pick<Extract<BuilderEdit, { kind: 'moveAthlete' }>, 'athlete' | 'fromSession' | 'fromPlatform' | 'occurrence'>;

type Bench = { unplaced: BuiltAthlete[]; removed: BuiltAthlete[]; addedKeys: ReadonlySet<string> };

function firstWithKey(slots: readonly Slot[], key: string): { group: Group; index: number } | null {
  for (const slot of slots) {
    for (const group of slot.groups.values()) {
      const index = group.athletes.findIndex((a) => a.key === key);
      if (index !== -1) return { group, index };
    }
  }
  return null;
}

function findAthlete(slots: readonly Slot[], edit: AthleteAt): { group: Group; index: number } | null {
  if (edit.fromSession === undefined || edit.fromPlatform === undefined) return firstWithKey(slots, edit.athlete);
  const group = slots.find((s) => s.id === edit.fromSession)?.groups.get(edit.fromPlatform);
  const athlete = group ? [...group.athletes].sort(byTotal).filter((a) => a.key === edit.athlete)[edit.occurrence ?? 0] : undefined;
  return group && athlete ? { group, index: group.athletes.indexOf(athlete) } : null;
}

function targetGroup(slots: readonly Slot[], options: BuilderOptions, session: number, platform: string, like: Pick<Group, 'gender' | 'ageGroup'>): Group | null {
  const slot = slots.find((s) => s.id === session);
  if (!slot || !options.platforms.includes(platform)) return null;
  const existing = slot.groups.get(platform);
  if (existing) return existing;
  const created: Group = { gender: like.gender, ageGroup: like.ageGroup, split: '', splitOf: '', athletes: [], edited: true };
  slot.groups.set(platform, created);
  return created;
}

function applyEdit(slots: Slot[], edit: BuilderEdit, options: BuilderOptions, bench: Bench | null): EditOutcome {
  switch (edit.kind) {
    case 'addAthlete': {
      const index = bench?.unplaced.findIndex((a) => a.key === edit.athlete) ?? -1;
      const athlete = bench?.unplaced[index];
      if (!bench || !athlete) return 'skipped';
      const target = targetGroup(slots, options, edit.toSession, edit.toPlatform, { gender: athlete.gender, ageGroup: ageGroupOf(athlete.age, options.separateAgeGroups) });
      if (!target) return 'skipped';
      bench.unplaced.splice(index, 1);
      target.athletes.push(athlete);
      target.edited = true;
      return 'applied';
    }
    case 'removeAthlete': {
      const found = bench ? findAthlete(slots, edit) : null;
      if (!bench || !found) return 'skipped';
      const [athlete] = found.group.athletes.splice(found.index, 1);
      found.group.edited = true;
      if (athlete) (bench.addedKeys.has(athlete.key) ? bench.unplaced : bench.removed).push(athlete);
      return 'applied';
    }
    case 'moveAthlete': {
      const found = findAthlete(slots, edit);
      if (!found) return 'skipped';
      const target = targetGroup(slots, options, edit.toSession, edit.toPlatform, found.group);
      if (!target) return 'skipped';
      if (target === found.group) return 'applied';
      const [athlete] = found.group.athletes.splice(found.index, 1);
      if (athlete) target.athletes.push(athlete);
      found.group.edited = true;
      target.edited = true;
      return 'applied';
    }
    case 'moveClass': {
      const source = slots.find((s) => s.id === edit.fromSession)?.groups.get(edit.fromPlatform);
      const weightClass = bareWeightClass(edit.weightClass);
      if (!source || !source.athletes.some((a) => a.weightClass === weightClass)) return 'skipped';
      const target = targetGroup(slots, options, edit.toSession, edit.toPlatform, source);
      if (!target) return 'skipped';
      if (target === source) return 'applied';
      target.athletes.push(...source.athletes.filter((a) => a.weightClass === weightClass));
      source.athletes = source.athletes.filter((a) => a.weightClass !== weightClass);
      source.edited = true;
      target.edited = true;
      return 'applied';
    }
    case 'swapSessions': {
      const a = slots.find((s) => s.id === edit.session);
      const b = slots.find((s) => s.id === edit.withSession);
      if (!a || !b || a === b) return 'skipped';
      [a.groups, b.groups] = [b.groups, a.groups];
      return 'applied';
    }
    case 'setSessionTime': {
      const slot = slots.find((s) => s.id === edit.session);
      const start = minutesOfClock(edit.startTime);
      if (!slot || start === null || start < WEIGH_IN_MINUTES || start + options.sessionMinutes > MINUTES_PER_DAY) return 'skipped';
      if (!options.days.some((d) => d.date === edit.date)) return 'skipped';
      slot.date = edit.date;
      slot.start = start;
      slot.retimed = true;
      return 'applied';
    }
  }
}

function groupLabels(group: Group, athletes: readonly BuiltAthlete[], options: BuilderOptions, editedSplits: ReadonlySet<string>): { gender: string; ageGroup: AgePool; split: string; mixed: boolean } {
  const genders = [...new Set(athletes.map((a) => a.gender))];
  const [only] = genders;
  const gender = genders.length === 1 && only !== undefined ? only : group.gender;
  const split = group.splitOf !== '' && editedSplits.has(group.splitOf) ? '' : group.split;
  if (!group.edited) return { gender, ageGroup: group.ageGroup, split, mixed: genders.length > 1 };
  const pools = [...new Set(athletes.map((a) => ageGroupOf(a.age, options.separateAgeGroups)))];
  const [pool] = pools;
  return { gender, ageGroup: pools.length === 1 && pool !== undefined ? pool : '', split: '', mixed: genders.length > 1 };
}

export function overlapWarnings(sessions: readonly BuiltSession[], sessionMinutes: number, warnsOf: (session: BuiltSession) => boolean = () => true): BuilderWarning[] {
  const scheduled = sessions.flatMap((session) => {
    const start = minutesOfClock(session.startTime.slice(0, 5));
    return start === null || session.date === '' ? [] : [{ session, start }];
  });
  const warnings: BuilderWarning[] = [];
  scheduled.forEach(({ session, start }, i) => {
    for (const later of scheduled.slice(i + 1)) {
      if (later.session.date !== session.date || later.start >= start + sessionMinutes || start >= later.start + sessionMinutes) continue;
      if (!warnsOf(session) && !warnsOf(later.session)) continue;
      const shared = session.groups.map((g) => g.platform).filter((platform) => later.session.groups.some((g) => g.platform === platform));
      for (const platform of shared) {
        warnings.push({ code: 'overlap', message: `Sessions ${session.number} and ${later.session.number} use the ${platform} platform at the same time.` });
      }
    }
  });
  return warnings;
}

type Numbering = 'inTimeOrder' | 'asPublished';

function finish(slots: readonly Slot[], options: BuilderOptions, athletes: number, skipped: number, numbering: Numbering = 'inTimeOrder'): BuiltSchedule {
  const warnings: BuilderWarning[] = [];
  const editedSplits = new Set(slots.flatMap((slot) => [...slot.groups.values()].filter((g) => g.edited && g.splitOf !== '').map((g) => g.splitOf)));
  const untouchedPublished = (group: Group) => !group.edited && group.published !== undefined;
  const kept = slots
    .map((slot) => ({
      slot,
      groups: options.platforms.flatMap((platform) => {
        const group = slot.groups.get(platform);
        return group && (group.athletes.length > 0 || untouchedPublished(group)) ? [{ platform, group }] : [];
      }),
    }))
    .filter(({ groups }) => groups.length > 0)
    .sort((a, b) => {
      const aStart = a.slot.start;
      const bStart = b.slot.start;
      if ((aStart === null) !== (bStart === null)) return aStart === null ? 1 : -1;
      return compareBytes(a.slot.date, b.slot.date) || (aStart ?? 0) - (bStart ?? 0) || a.slot.id - b.slot.id;
    });
  const sessions = kept.map(({ slot, groups }, i): BuiltSession => {
    const number = numbering === 'asPublished' ? slot.id : i + 1;
    const scheduled = slot.start !== null && slot.date !== '';
    const computed: RowTimes = {
      date: scheduled ? slot.date : '',
      startTime: scheduled ? storedClockOf(slot.start ?? 0) : '',
      weighInTime: scheduled ? storedClockOf((slot.start ?? 0) - WEIGH_IN_MINUTES) : '',
    };
    const sessionRow = slot.retimed ? undefined : earliest([...(slot.published?.values() ?? [])].flat());
    const builtGroups = groups.map(({ platform, group }): BuiltGroup => {
      const sorted = [...group.athletes].sort(byTotal);
      const labels = groupLabels(group, sorted, options, editedSplits);
      if (labels.mixed) warnings.push({ code: 'mixedGroup', message: `Session ${number} ${platform} mixes women and men.` });
      if (sorted.length > options.maxAthletesPerPlatform) {
        warnings.push({ code: 'overCapacity', message: `Session ${number} ${platform} has ${sorted.length} athletes, more than the ${options.maxAthletesPerPlatform} allowed.` });
      }
      const built: BuiltGroup = {
        platform,
        gender: athleteGenderLabel(labels.gender),
        ageGroup: labels.ageGroup,
        split: labels.split,
        weightClasses: sortByWeightClass([...new Set(sorted.map((a) => a.weightClass))], (c) => c),
        athletes: sorted.map((a) => ({ ...a, gender: athleteGenderLabel(a.gender) })),
      };
      const own = slot.retimed ? undefined : (earliest(slot.published?.get(platform) ?? []) ?? sessionRow);
      const times = own ? timesOfPart(own) : undefined;
      const origin = group.edited ? undefined : group.published;
      if (!origin) return times ? { ...built, times } : built;
      const inPlace = origin.slot === slot.id && !slot.retimed;
      const relabelled = group.splitOf !== '' && editedSplits.has(group.splitOf);
      const publishedRows = origin.rows.map((row) => ({ ...(inPlace ? timesOfPart(row) : (times ?? computed)), weightClass: relabelled ? platformLabel(built) : row.weightClass }));
      return { ...built, ...(times ? { times } : {}), publishedRows };
    });
    const own = slot.published && !slot.retimed && scheduled ? earliest(builtGroups.flatMap((group) => (group.times ? [group.times] : []))) : undefined;
    return { id: slot.id, number, ...(own ?? computed), groups: builtGroups };
  });
  const outOfPlace = (slot: Slot, group: Group) => group.edited || (group.published !== undefined && group.published.slot !== slot.id);
  const touched = new Set(kept.filter(({ slot, groups }) => slot.retimed || groups.some(({ group }) => outOfPlace(slot, group))).map(({ slot }) => slot.id));
  const warnsOf = numbering === 'asPublished' ? (session: BuiltSession) => touched.has(session.id) : () => true;
  warnings.push(...overlapWarnings(sessions, options.sessionMinutes, warnsOf));
  const unscheduled = sessions.filter((s) => s.startTime === '').length;
  if (athletes === 0) warnings.unshift({ code: 'noEntrants', message: 'The meet has no entrants yet.' });
  if (unscheduled > 0) {
    warnings.unshift({
      code: 'unscheduled',
      message: `${unscheduled} session${unscheduled === 1 ? '' : 's'} did not fit in the meet's days. Add a day, more platforms, more sessions per day or more athletes per session.`,
    });
  }
  if (skipped > 0) warnings.push({ code: 'skippedEdit', message: `${skipped} edit${skipped === 1 ? '' : 's'} no longer fit the entries and ${skipped === 1 ? 'was' : 'were'} left out.` });
  return { athletes, sessions, warnings };
}

export function buildSchedule(entrants: readonly BuilderEntrant[], options: BuilderOptions, edits: readonly BuilderEdit[] = []): BuiltSchedule {
  const slots = initialSlots(entrants, options);
  let skipped = 0;
  for (const edit of edits) if (applyEdit(slots, edit, options, null) === 'skipped') skipped++;
  return finish(slots, options, entrants.length, skipped);
}

export type RosterAthlete = BuilderEntrant & { _id: string; sessionNumber?: number; sessionPlatform?: string; adaptive: boolean };

export type PublishedRow = RowTimes & { sessionId: number; platform: string; weightClass: string };

export type Sport80Entrant = BuilderEntrant & { wso?: string };

export type PublishedBase = { rows: readonly PublishedRow[]; roster: readonly RosterAthlete[]; sport80: readonly Sport80Entrant[] | null };

export type PublishedBuild = BuiltSchedule & { unplaced: BuiltAthlete[]; removed: BuiltAthlete[] };

export type Sport80Diff = { added: Sport80Entrant[]; withdrawnIds: ReadonlySet<string> };

const NO_SPORT80_DIFF: Sport80Diff = { added: [], withdrawnIds: new Set() };

function addTo<Value>(map: Map<string, Value[]>, key: string, value: Value): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function sport80Diff(base: PublishedBase): Sport80Diff {
  if (base.sport80 === null) return NO_SPORT80_DIFF;
  const scheduled = base.roster.filter(hasSession);
  const byIdentity = new Map<string, RosterAthlete[]>();
  const byNameAndGender = new Map<string, RosterAthlete[]>();
  for (const athlete of scheduled) {
    const folded = normalizeName(athlete.name);
    addTo(byIdentity, athleteKeyOf(athlete.memberId, folded), athlete);
    addTo(byNameAndGender, foldedNameAndGender(folded, athlete.gender), athlete);
  }
  const listed = new Set<string>();
  const notByIdentity: { entrant: Sport80Entrant; folded: string }[] = [];
  for (const entrant of base.sport80) {
    const folded = normalizeName(entrant.name);
    const same = byIdentity.get(athleteKeyOf(entrant.memberId, folded)) ?? [];
    for (const athlete of same) listed.add(athlete._id);
    if (same.length === 0) notByIdentity.push({ entrant, folded });
  }
  const added = notByIdentity
    .filter(({ entrant, folded }) => {
      const same = (byNameAndGender.get(foldedNameAndGender(folded, entrant.gender)) ?? []).filter(
        (athlete) => !listed.has(athlete._id) && (hasNoMemberId(athlete.memberId) || hasNoMemberId(entrant.memberId)),
      );
      for (const athlete of same) listed.add(athlete._id);
      return same.length === 0;
    })
    .map(({ entrant }) => entrant);
  return { added, withdrawnIds: new Set(scheduled.filter((athlete) => !listed.has(athlete._id) && !athlete.adaptive).map((athlete) => athlete._id)) };
}

export const rosterEntrant = (athlete: RosterAthlete): BuilderEntrant => ({ ...athlete, rosterId: athlete._id });

export function scratchEntrants(base: PublishedBase, diff: Sport80Diff): BuilderEntrant[] {
  const startList = base.roster.filter((athlete) => hasSession(athlete) && !diff.withdrawnIds.has(athlete._id));
  return [...startList.map(rosterEntrant), ...diff.added];
}

const SPLIT_LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode('A'.charCodeAt(0) + i));

function poolsToTry(separate: boolean): AgePool[] {
  return separate ? ['open', 'youth', 'masters', ''] : ['', 'youth', 'masters', 'open'];
}

function publishedGroupLabels(group: Group, label: string, separate: boolean): Pick<Group, 'ageGroup' | 'split' | 'splitOf'> {
  const gender = athleteGenderLabel(group.gender);
  const weightClasses = sortByWeightClass([...new Set(group.athletes.map((a) => a.weightClass))], (c) => c);
  for (const ageGroup of poolsToTry(separate)) {
    for (const split of ['', ...SPLIT_LETTERS]) {
      if (platformLabel({ gender, weightClasses, split, ageGroup }) === label.trim()) {
        return { ageGroup, split, splitOf: split === '' ? '' : `${group.gender}|${ageGroup}|${weightClasses.join(',')}` };
      }
    }
  }
  const pools = [...new Set(group.athletes.map((a) => ageGroupOf(a.age, separate)))];
  const [pool] = pools;
  return { ageGroup: pools.length === 1 && pool !== undefined ? pool : '', split: '', splitOf: '' };
}

export function publishedPlatforms(base: Pick<PublishedBase, 'rows' | 'roster'>): Set<string> {
  const fromRoster = base.roster.filter(hasSession).map((athlete) => (athlete.sessionPlatform ?? '').trim());
  return new Set([...base.rows.map((row) => row.platform.trim()), ...fromRoster].filter((platform) => platform !== ''));
}

function publishedSlots(base: PublishedBase, options: BuilderOptions, withdrawnIds: ReadonlySet<string>): Slot[] {
  const slots = new Map<number, Slot>();
  for (const row of [...base.rows].sort((a, b) => a.sessionId - b.sessionId)) {
    const part: PublishedPart = { date: row.date, startTime: row.startTime, weighInTime: row.weighInTime, weightClass: row.weightClass };
    const start = minutesOfStoredClock(row.startTime);
    const slot = slots.get(row.sessionId) ?? { id: row.sessionId, date: row.date, start, groups: new Map<string, Group>(), published: new Map<string, PublishedPart[]>() };
    slots.set(row.sessionId, slot);
    if (slot.published) addTo(slot.published, row.platform.trim(), part);
    if (start !== null && (slot.start === null || start < slot.start)) {
      slot.start = start;
      slot.date = row.date;
    }
  }
  for (const athlete of base.roster) {
    if (!hasSession(athlete) || athlete.sessionNumber === undefined) continue;
    const id = athlete.sessionNumber;
    const platform = (athlete.sessionPlatform ?? '').trim();
    const slot = slots.get(id) ?? { id, date: '', start: null, groups: new Map<string, Group>() };
    slots.set(id, slot);
    const built = builtAthleteOf(rosterEntrant(athlete));
    const group = slot.groups.get(platform) ?? { gender: built.gender, ageGroup: '', split: '', splitOf: '', athletes: [], edited: false };
    slot.groups.set(platform, group);
    group.athletes.push(withdrawnIds.has(athlete._id) ? { ...built, withdrawn: true } : built);
  }
  for (const slot of slots.values()) {
    for (const platform of slot.published?.keys() ?? []) {
      if (!slot.groups.has(platform)) slot.groups.set(platform, { gender: '', ageGroup: '', split: '', splitOf: '', athletes: [], edited: false });
    }
    for (const [platform, group] of slot.groups) {
      const rows = slot.published?.get(platform);
      Object.assign(group, publishedGroupLabels(group, rows?.[0]?.weightClass ?? '', options.separateAgeGroups), rows ? { published: { slot: slot.id, rows } } : {});
    }
  }
  return [...slots.values()];
}

function withPublishedPlatforms(options: BuilderOptions, slots: readonly Slot[]): BuilderOptions {
  const published = slots.flatMap((slot) => [...slot.groups.keys()]);
  return { ...options, platforms: [...new Set([...options.platforms, ...published])] };
}

const outsideTheBoard = (athlete: BuiltAthlete): BuiltAthlete => ({ ...athlete, gender: athleteGenderLabel(athlete.gender) });

export function buildFromPublished(base: PublishedBase, diff: Sport80Diff, options: BuilderOptions, edits: readonly BuilderEdit[] = []): PublishedBuild {
  const slots = publishedSlots(base, options, diff.withdrawnIds);
  const effective = withPublishedPlatforms(options, slots);
  const unplaced = diff.added.map(builtAthleteOf).sort((a, b) => compareCollated(a.name, b.name) || compareBytes(a.key, b.key));
  const bench: Bench = { unplaced, removed: [], addedKeys: new Set(unplaced.map((a) => a.key)) };
  let skipped = 0;
  for (const edit of edits) if (applyEdit(slots, edit, effective, bench) === 'skipped') skipped++;
  const placed = slots.reduce((sum, slot) => sum + [...slot.groups.values()].reduce((n, group) => n + group.athletes.length, 0), 0);
  return {
    ...finish(slots, effective, placed, skipped, 'asPublished'),
    unplaced: bench.unplaced.map(outsideTheBoard),
    removed: bench.removed.map(outsideTheBoard),
  };
}

export type RosterRemoval = { id: string; name: string };

export type RosterChanges = { add: readonly Sport80Entrant[]; remove: readonly RosterRemoval[] };

export const NO_ROSTER_CHANGES: RosterChanges = { add: [], remove: [] };

export function rosterChangesOf(diff: Sport80Diff, build: PublishedBuild): RosterChanges {
  const unplaced = new Set(build.unplaced.map((athlete) => athlete.key));
  return {
    add: diff.added.filter((entrant) => !unplaced.has(athleteKey(entrant))),
    remove: build.removed.flatMap((athlete) => (athlete.rosterId === undefined ? [] : [{ id: athlete.rosterId, name: athlete.name }])),
  };
}

export function scratchRosterChanges(base: PublishedBase, diff: Sport80Diff): RosterChanges {
  return { add: diff.added, remove: base.roster.filter((athlete) => diff.withdrawnIds.has(athlete._id)).map((athlete) => ({ id: athlete._id, name: athlete.name })) };
}

export function unlistedRemovals(build: PublishedBuild): string[] {
  return build.removed.filter((athlete) => !athlete.withdrawn).map((athlete) => athlete.name);
}

function publishedSessionMinutes(rows: readonly PublishedRow[], fallback: number): number {
  const firstStarts = new Map<string, { lane: string; start: number }>();
  for (const row of rows) {
    const start = minutesOfStoredClock(row.startTime);
    if (row.date === '' || start === null) continue;
    const lane = `${row.date}|${row.platform.trim()}`;
    const key = `${lane}|${row.sessionId}`;
    const first = firstStarts.get(key);
    if (!first || start < first.start) firstStarts.set(key, { lane, start });
  }
  const starts = new Map<string, number[]>();
  for (const { lane, start } of firstStarts.values()) addTo(starts, lane, start);
  const gaps = [...starts.values()].flatMap((list) => {
    const sorted = [...new Set(list)].sort((a, b) => a - b);
    return sorted.slice(1).map((start, i) => start - (sorted[i] ?? start));
  });
  if (gaps.length === 0) return fallback;
  const { min, max } = BUILDER_LIMITS.sessionMinutes;
  return Math.min(max, Math.max(min, Math.min(...gaps)));
}

export function publishedOptions(rows: readonly PublishedRow[], meet: { startDate: string; endDate: string }): BuilderOptions {
  const defaults = defaultBuilderOptions(meet);
  const sessionMinutes = publishedSessionMinutes(rows, defaults.sessionMinutes);
  const firstStarts = new Map<string, number>();
  for (const row of rows) {
    const start = minutesOfStoredClock(row.startTime);
    if (row.date === '' || start === null) continue;
    firstStarts.set(row.date, Math.min(start, firstStarts.get(row.date) ?? start));
  }
  const latestFirstStart = MINUTES_PER_DAY - sessionMinutes;
  const days = [...firstStarts]
    .sort(([a], [b]) => compareBytes(a, b))
    .slice(0, MAX_BUILDER_DAYS)
    .map(([date, start]) => ({ date, firstStart: storedClockOf(Math.min(latestFirstStart, Math.max(WEIGH_IN_MINUTES, start))).slice(0, 5) }));
  const platforms = [...new Set([...rows].sort((a, b) => a.sessionId - b.sessionId).map((row) => row.platform.trim()))].filter((p) => p !== '').slice(0, MAX_BUILDER_PLATFORMS);
  return { ...defaults, sessionMinutes, days: days.length > 0 ? days : defaults.days, platforms: platforms.length > 0 ? platforms : defaults.platforms };
}
