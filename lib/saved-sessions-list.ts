import { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { isSamePlatform } from '@/lib/athletes';
import { capAthleteNames } from '@/lib/saved-sessions-outbox';
import type { SavedSession } from '@/lib/saved-sessions-store';
import type { Schedule as ScheduleType } from '@/types/schedule';
import { generateSessionId } from '@/utils/session';
import { calculateWeighInTime } from '@/utils/time';

/**
 * Pure transforms over the saved-sessions list: the upsert a save applies,
 * the undo of a save the server refused, and the rows a "save all athletes"
 * produces. No storage, no network; the hook's actions run these inside the
 * mutation queue.
 */

export interface SessionUpsert {
  nextSessions: SavedSession[];
  /** The row as it is stored after the upsert. */
  updatedSession: SavedSession;
  /** The row it replaced, if any; restored if the server refuses the save. */
  previousSession: SavedSession | undefined;
  isUpdate: boolean;
}

/**
 * Insert `session`, or merge it over the stored row with the same id.
 * Athlete names are capped the same on both sides of the sync, so what the
 * device shows is what the server holds (the backend answers 400 above the
 * limit).
 */
export function upsertSession(
  currentSessions: SavedSession[],
  session: SavedSession,
): SessionUpsert {
  const nextSessions = [...currentSessions];

  const existingSessionIndex = nextSessions.findIndex(s => s.id === session.id);
  let updatedSession: SavedSession;
  const previousSession =
    existingSessionIndex >= 0 ? nextSessions[existingSessionIndex] : undefined;
  if (existingSessionIndex >= 0) {
    const existingSession = nextSessions[existingSessionIndex];
    updatedSession = { ...existingSession, ...session }; // Merge new data over existing
  } else {
    updatedSession = { ...session };
  }
  if (updatedSession.athleteNames) {
    updatedSession.athleteNames = capAthleteNames(updatedSession.athleteNames);
  }
  if (existingSessionIndex >= 0) {
    nextSessions[existingSessionIndex] = updatedSession;
  } else {
    nextSessions.push(updatedSession);
  }
  return {
    nextSessions,
    updatedSession,
    previousSession,
    isUpdate: existingSessionIndex >= 0,
  };
}

/**
 * Undo a save the server refused: put `previousSession` back, or drop the
 * row if the save created it. Returns null (leave the list alone) when the
 * stored row is no longer exactly the one that was refused.
 */
/** Structural equality that ignores object key order. */
function sameSession(a: SavedSession, b: SavedSession): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]);
    }
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function revertRefusedSave(
  currentSessions: SavedSession[],
  refused: SavedSession,
  previousSession: SavedSession | undefined,
): SavedSession[] | null {
  const index = currentSessions.findIndex(s => s.id === refused.id);
  if (index < 0 || !sameSession(currentSessions[index], refused)) {
    return null;
  }
  const next = [...currentSessions];
  if (previousSession) next[index] = previousSession;
  else next.splice(index, 1);
  return next;
}

/**
 * One saved session per (session number, platform) the athletes are entered
 * in, carrying the de-duplicated names of the athletes in it. Times, date
 * and weight class come from `schedule` when it has that platform-session,
 * and from the athlete's own session fields otherwise.
 */
export function sessionsFromAthletes(
  athletes: LiftResult[],
  meet: MeetName,
  schedule: ScheduleType,
): SavedSession[] {
  const sessionMap = new Map<string, { session: SavedSession, athletes: string[] }>();

  athletes
    .filter(athlete => athlete.session)
    .forEach(athlete => {
      const sessionId = generateSessionId(meet, athlete.session!.number, athlete.session!.platform);

      if (!sessionMap.has(sessionId)) {
        // Find session details in schedule
        const sessionDay = schedule.find(day =>
          day.sessions.some(s => s.number === athlete.session?.number)
        );

        const scheduleSession = sessionDay?.sessions.find(s =>
          s.number === athlete.session?.number
        );

        const platform = scheduleSession?.platforms.find(p =>
          isSamePlatform(p.platform, athlete.session?.platform)
        );

        if (sessionDay && scheduleSession && platform) {
          const startTime = platform.platformStartTime || scheduleSession.startTime;
          const weighInTime = calculateWeighInTime(startTime);
          sessionMap.set(sessionId, {
            session: {
              id: sessionId,
              meet,
              sessionNumber: athlete.session!.number,
              platform: athlete.session!.platform,
              weightClass: platform.weightClass,
              startTime,
              weighInTime,
              date: sessionDay.fullDate,
              athleteNames: []
            },
            athletes: []
          });
        } else {
          const fallbackStartTime = athlete.session?.startTime ?? '';
          sessionMap.set(sessionId, {
            session: {
              id: sessionId,
              meet,
              sessionNumber: athlete.session!.number,
              platform: athlete.session!.platform,
              weightClass: athlete.weightClass ?? '',
              startTime: fallbackStartTime,
              weighInTime: calculateWeighInTime(fallbackStartTime),
              date: athlete.session?.date ?? '',
              athleteNames: []
            },
            athletes: []
          });
        }
      }

      const sessionData = sessionMap.get(sessionId);
      if (sessionData) {
        sessionData.athletes.push(athlete.name);
      }
    });

  return Array.from(sessionMap.values()).map(({ session, athletes: names }) => {
    // Ensure athleteNames has unique values
    return {
      ...session,
      athleteNames: [...new Set(names)]
    };
  });
}

/**
 * Lay a generated session over the stored row with the same id: the stored
 * row keeps its notes and other fields, the new schedule data (e.g. time)
 * wins, and athlete names are the union of both.
 */
export function mergeWithStoredSession(
  sessionToSave: SavedSession,
  storedSessions: SavedSession[],
): SavedSession {
  const existingLocalSession = storedSessions.find(s => s.id === sessionToSave.id);
  if (!existingLocalSession) return { ...sessionToSave };
  const combinedNames = [...new Set([...(existingLocalSession.athleteNames || []), ...(sessionToSave.athleteNames || [])])];
  return {
    ...existingLocalSession, // Keep existing notes, etc.
    ...sessionToSave, // Overwrite with new schedule data (like time)
    athleteNames: combinedNames, // Use the merged names
  };
}
