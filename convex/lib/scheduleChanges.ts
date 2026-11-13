import { ageGroupOf, type BuiltAthlete, type BuiltGroup, type BuiltSession, type PublishedBuild } from './scheduleBuilder';
import { classLimit } from './weightClass';

export type BoardPlace = { session: number; number: number; platform: string };

export type AddedEntrant = { athlete: BuiltAthlete; suggestion: BoardPlace | null };

export type WithdrawnAthlete = { athlete: BuiltAthlete; place: BoardPlace; occurrence: number };

export type Sport80Changes = { checkedAt: number | null; added: AddedEntrant[]; withdrawn: WithdrawnAthlete[]; addedNote: string; withdrawnNote: string };

type Candidate = { session: BuiltSession; group: BuiltGroup };

const SUPERHEAVY_ABOVE_ITS_LIMIT = 0.5;

function classWeight(weightClass: string): number {
  const limit = classLimit(weightClass);
  if (!limit) return Number.POSITIVE_INFINITY;
  return limit.limit + (limit.open ? SUPERHEAVY_ABOVE_ITS_LIMIT : 0);
}

function classDistance(group: BuiltGroup, weightClass: string): number {
  const weight = classWeight(weightClass);
  return Math.min(Number.POSITIVE_INFINITY, ...group.weightClasses.map((c) => Math.abs(classWeight(c) - weight)));
}

function best(candidates: readonly Candidate[], better: (a: Candidate, b: Candidate) => number): Candidate | null {
  return candidates.reduce<Candidate | null>((chosen, candidate) => (chosen === null || better(candidate, chosen) < 0 ? candidate : chosen), null);
}

const fewerAthletes = (a: Candidate, b: Candidate) => a.group.athletes.length - b.group.athletes.length;

export function suggestedPlace(entrant: BuiltAthlete, sessions: readonly BuiltSession[], separateAgeGroups: boolean): BoardPlace | null {
  const pool = ageGroupOf(entrant.age, separateAgeGroups);
  const samePool = (candidate: Candidate) => !separateAgeGroups || candidate.group.ageGroup === pool;
  const sameGender = sessions.flatMap((session) => session.groups.filter((group) => group.gender === entrant.gender && !group.locked).map((group) => ({ session, group })));
  const sameClass = sameGender.filter((candidate) => candidate.group.weightClasses.includes(entrant.weightClass) && samePool(candidate));
  const chosen =
    sameClass.length > 0
      ? best(sameClass, fewerAthletes)
      : best(
          sameGender,
          (a, b) =>
            Number(samePool(b)) - Number(samePool(a)) ||
            classDistance(a.group, entrant.weightClass) - classDistance(b.group, entrant.weightClass) ||
            fewerAthletes(a, b),
        );
  return chosen ? { session: chosen.session.id, number: chosen.session.number, platform: chosen.group.platform } : null;
}

function withdrawnOf(session: BuiltSession, group: BuiltGroup): WithdrawnAthlete[] {
  return group.athletes.flatMap((athlete, row) =>
    athlete.withdrawn
      ? [{ athlete, place: { session: session.id, number: session.number, platform: group.platform }, occurrence: group.athletes.slice(0, row).filter((a) => a.key === athlete.key).length }]
      : [],
  );
}

export function addedNote(unplaced: number, placed: number): string {
  if (unplaced > 0) return `${unplaced} new ${unplaced === 1 ? 'lifter isn’t' : 'lifters aren’t'} placed, so they stay off the start list when you publish.`;
  return placed > 0 ? 'Every new lifter is placed.' : 'No new lifters.';
}

export function withdrawnNote(removable: number, locked: number, removed: number): string {
  const marked = removable > 0 ? `${removable} ${removable === 1 ? 'lifter is' : 'lifters are'} marked on the board. Remove takes them off the start list when you publish.` : '';
  const leaving = removed > 0 ? `${removed} ${removed === 1 ? 'lifter comes' : 'lifters come'} off the start list when you publish.` : '';
  const note = [marked, leaving].filter((sentence) => sentence !== '').join(' ');
  if (note !== '') return note;
  return locked === 0 ? 'Every published lifter is still on Sport80.' : 'No lifter marked on the board can be removed here.';
}

export function sport80Changes(build: PublishedBuild, checkedAt: number | null, separateAgeGroups: boolean, placedAdded = 0): Sport80Changes {
  const withdrawn = build.sessions.flatMap((session) => session.groups.flatMap((group) => withdrawnOf(session, group).map((entry) => ({ entry, locked: group.locked === true }))));
  const locked = withdrawn.filter((w) => w.locked).length;
  return {
    checkedAt,
    added: build.unplaced.map((athlete) => ({ athlete, suggestion: suggestedPlace(athlete, build.sessions, separateAgeGroups) })),
    withdrawn: withdrawn.map((w) => w.entry),
    addedNote: addedNote(build.unplaced.length, placedAdded),
    withdrawnNote: withdrawnNote(withdrawn.length - locked, locked, build.removed.filter((athlete) => athlete.withdrawn).length),
  };
}
