import { chunks } from './concurrency';
import { groupOfAge } from './elite';
import { athleteGenderLabel, normalizeGender } from './normalize';
import { normalizeName } from './names';
import { compareBytes, compareCollated, sortByWeightClass } from './sort';
import { bareWeightClass } from './weightClass';
import { MINUTES_PER_DAY, WEIGH_IN_MINUTES, minutesOfClock, storedClockOf, type BuilderEdit, type BuilderOptions, type BuilderOrder } from './scheduleBuilderOptions';

export type BuilderEntrant = {
  memberId: string;
  name: string;
  age: number;
  club: string;
  gender: string;
  weightClass: string;
  entryTotal: number;
};

export type AgePool = 'youth' | 'open' | 'masters' | '';

export type BuiltAthlete = BuilderEntrant & { key: string };

export type BuiltGroup = {
  platform: string;
  gender: string;
  ageGroup: AgePool;
  split: string;
  weightClasses: string[];
  athletes: BuiltAthlete[];
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

type Group = { gender: string; ageGroup: AgePool; split: string; splitOf: string; athletes: BuiltAthlete[]; edited: boolean };

type Slot = { id: number; date: string; start: number | null; groups: Map<string, Group> };

const GENDER_ORDER = ['Women', 'Men'];
const POOL_ORDER: readonly AgePool[] = ['youth', '', 'open', 'masters'];

export function athleteKey(entrant: Pick<BuilderEntrant, 'memberId' | 'name'>): string {
  return `${entrant.memberId}|${normalizeName(entrant.name)}`;
}

function ageGroupOf(age: number, separate: boolean): AgePool {
  if (!separate) return '';
  const group = groupOfAge(age);
  if (group === 'youth' || group === 'masters') return group;
  return 'open';
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
    pool.athletes.push({ ...entrant, gender, weightClass: bareWeightClass(entrant.weightClass), key: athleteKey(entrant) });
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

type MoveAthlete = Extract<BuilderEdit, { kind: 'moveAthlete' }>;

function firstWithKey(slots: readonly Slot[], key: string): { group: Group; index: number } | null {
  for (const slot of slots) {
    for (const group of slot.groups.values()) {
      const index = group.athletes.findIndex((a) => a.key === key);
      if (index !== -1) return { group, index };
    }
  }
  return null;
}

function findAthlete(slots: readonly Slot[], edit: MoveAthlete): { group: Group; index: number } | null {
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

function applyEdit(slots: Slot[], edit: BuilderEdit, options: BuilderOptions): EditOutcome {
  switch (edit.kind) {
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

export function overlapWarnings(sessions: readonly BuiltSession[], sessionMinutes: number): BuilderWarning[] {
  const scheduled = sessions.flatMap((session) => {
    const start = minutesOfClock(session.startTime.slice(0, 5));
    return start === null || session.date === '' ? [] : [{ session, start }];
  });
  const warnings: BuilderWarning[] = [];
  scheduled.forEach(({ session, start }, i) => {
    for (const later of scheduled.slice(i + 1)) {
      if (later.session.date !== session.date || later.start >= start + sessionMinutes || start >= later.start + sessionMinutes) continue;
      const shared = session.groups.map((g) => g.platform).filter((platform) => later.session.groups.some((g) => g.platform === platform));
      for (const platform of shared) {
        warnings.push({ code: 'overlap', message: `Sessions ${session.number} and ${later.session.number} use the ${platform} platform at the same time.` });
      }
    }
  });
  return warnings;
}

function finish(slots: readonly Slot[], options: BuilderOptions, athletes: number, skipped: number): BuiltSchedule {
  const warnings: BuilderWarning[] = [];
  const editedSplits = new Set(slots.flatMap((slot) => [...slot.groups.values()].filter((g) => g.edited && g.splitOf !== '').map((g) => g.splitOf)));
  const kept = slots
    .map((slot) => ({
      slot,
      groups: options.platforms.flatMap((platform) => {
        const group = slot.groups.get(platform);
        return group && group.athletes.length > 0 ? [{ platform, group }] : [];
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
    const scheduled = slot.start !== null && slot.date !== '';
    const builtGroups = groups.map(({ platform, group }): BuiltGroup => {
      const sorted = [...group.athletes].sort(byTotal);
      const labels = groupLabels(group, sorted, options, editedSplits);
      if (labels.mixed) warnings.push({ code: 'mixedGroup', message: `Session ${i + 1} ${platform} mixes women and men.` });
      if (sorted.length > options.maxAthletesPerPlatform) {
        warnings.push({ code: 'overCapacity', message: `Session ${i + 1} ${platform} has ${sorted.length} athletes, more than the ${options.maxAthletesPerPlatform} allowed.` });
      }
      return {
        platform,
        gender: athleteGenderLabel(labels.gender),
        ageGroup: labels.ageGroup,
        split: labels.split,
        weightClasses: sortByWeightClass([...new Set(sorted.map((a) => a.weightClass))], (c) => c),
        athletes: sorted.map((a) => ({ ...a, gender: athleteGenderLabel(a.gender) })),
      };
    });
    return {
      id: slot.id,
      number: i + 1,
      date: scheduled ? slot.date : '',
      startTime: scheduled ? storedClockOf(slot.start ?? 0) : '',
      weighInTime: scheduled ? storedClockOf((slot.start ?? 0) - WEIGH_IN_MINUTES) : '',
      groups: builtGroups,
    };
  });
  warnings.push(...overlapWarnings(sessions, options.sessionMinutes));
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
  for (const edit of edits) if (applyEdit(slots, edit, options) === 'skipped') skipped++;
  return finish(slots, options, entrants.length, skipped);
}
