import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MeetName } from '@/data/types/meet';
import type { SavedSession } from '@/lib/saved-sessions-store';
import { migrateSessionsToMeetSpecific } from '@/utils/migration';
import { getAllSavedSessionsKeys, getSavedSessionsKey } from '@/utils/session';

/**
 * Storage policy for the AsyncStorage keys saved sessions used to live under.
 *
 * Reset and migration both have to sweep those keys, and the Saved screen
 * used to do it inline — `JSON.parse` cast straight to `{ meet?: string }[]`
 * and the primary key rewritten behind the hook's back. The hook owns the
 * primary key; this module owns only the legacy ones.
 */

/** Every legacy key (never the primary key) a user's sessions may still sit under. */
export function getLegacySavedSessionsKeys(userId: string): string[] {
  const primary = getSavedSessionsKey(userId);
  return getAllSavedSessionsKeys(userId).filter((key) => key !== primary);
}

function parseRows(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowNeedsMeet(row: unknown): boolean {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return true;
  const meet = (row as Record<string, unknown>).meet;
  return typeof meet !== 'string' || meet.length === 0;
}

function rowMeet(row: unknown): string | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const meet = (row as Record<string, unknown>).meet;
  return typeof meet === 'string' ? meet : null;
}

export interface LegacyMigrationBatch {
  key: string;
  sessions: SavedSession[];
}

/**
 * Sessions stored without a `meet`, re-keyed to `currentMeet`, per key that
 * still holds any. A key whose rows all carry a meet needs nothing and is
 * left alone. Includes the primary key: pre-meet builds wrote there too.
 */
export async function findLegacySessionsNeedingMigration(
  userId: string,
  currentMeet: MeetName,
): Promise<LegacyMigrationBatch[]> {
  const batches: LegacyMigrationBatch[] = [];
  for (const key of getAllSavedSessionsKeys(userId)) {
    let rows: unknown[];
    try {
      rows = parseRows(await AsyncStorage.getItem(key));
    } catch (error) {
      console.error(`Saved sessions: could not read legacy key ${key}`, error);
      continue;
    }
    if (rows.length === 0 || !rows.some(rowNeedsMeet)) continue;
    // The primary key is the live list: only its meetless rows need
    // re-homing, and re-saving the rest would re-PUT every session the user
    // has. A legacy key is removed after migration, so all its rows move.
    const toMigrate = key === getSavedSessionsKey(userId) ? rows.filter(rowNeedsMeet) : rows;
    const sessions = migrateSessionsToMeetSpecific(toMigrate, currentMeet).filter(
      (session) =>
        typeof session.sessionNumber === 'number' &&
        typeof session.platform === 'string' &&
        session.platform.length > 0,
    );
    if (sessions.length > 0) batches.push({ key, sessions });
  }
  return batches;
}

/**
 * Drop a legacy key once its rows have been folded into the primary key.
 * The primary key is the hook's, so it is never removed here. Without this
 * the same rows were re-migrated — and re-PUT — on every Saved screen mount.
 */
export async function removeLegacySavedSessionsKey(userId: string, key: string): Promise<void> {
  if (key === getSavedSessionsKey(userId)) return;
  await AsyncStorage.removeItem(key);
}

/**
 * Apply a reset to the legacy keys: rows for `meet` are filtered out, or the
 * keys are removed outright when the reset covers every meet.
 */
export async function resetLegacySavedSessions(
  userId: string,
  meet: MeetName | null,
): Promise<void> {
  for (const key of getLegacySavedSessionsKeys(userId)) {
    try {
      if (meet === null) {
        await AsyncStorage.removeItem(key);
        continue;
      }
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      const rows = parseRows(raw);
      const kept = rows.filter((row) => rowMeet(row) !== meet);
      if (kept.length === rows.length) continue;
      if (kept.length === 0) {
        await AsyncStorage.removeItem(key);
      } else {
        await AsyncStorage.setItem(key, JSON.stringify(kept));
      }
    } catch (error) {
      console.error(`Saved sessions: could not reset legacy key ${key}`, error);
    }
  }
}
