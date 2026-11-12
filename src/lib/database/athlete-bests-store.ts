import { isRecord } from '@/lib/is-record';
import type { AthleteBests } from '@/data/types/athletes';
import { normalizeAthleteName } from '@/lib/athletes';
import { getAthleteBestsKey, legacyAthleteKeyName } from './offline-storage-keys';
import { multiGetBatched, multiSetBatched } from './storage-batches';

export const ATHLETE_BESTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const ATHLETE_BESTS_EMPTY_TTL_MS = 24 * 60 * 60 * 1000;

const ATHLETE_BESTS_FORMAT_VERSION = 2;

export type StoredAthleteBests = {
  bests: AthleteBests;
  fetchedAt: number;
  isFresh: boolean;
};

export function hasAnyAthleteBest(bests: AthleteBests): boolean {
  return bests.snatch_best != null || bests.cj_best != null || bests.total != null;
}

export function isAthleteBestsFresh(
  bests: AthleteBests,
  fetchedAt: number,
  now: number,
): boolean {
  const age = now - fetchedAt;
  const ttl = hasAnyAthleteBest(bests) ? ATHLETE_BESTS_TTL_MS : ATHLETE_BESTS_EMPTY_TTL_MS;
  return fetchedAt > 0 && age >= 0 && age < ttl;
}

function toStoredBestsValue(value: unknown): AthleteBests | null {
  if (!isRecord(value)) return null;
  const row = value as Partial<Record<keyof AthleteBests, unknown>>;
  const positiveOrNull = (candidate: unknown) =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
      ? candidate
      : null;
  return {
    snatch_best: positiveOrNull(row.snatch_best),
    cj_best: positiveOrNull(row.cj_best),
    total: positiveOrNull(row.total),
  };
}

function parseStoredAthleteBests(payload: string): { bests: AthleteBests; fetchedAt: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const candidate = parsed as { v?: unknown; fetchedAt?: unknown; bests?: unknown };
  if (candidate.v === ATHLETE_BESTS_FORMAT_VERSION) {
    const bests = toStoredBestsValue(candidate.bests);
    const fetchedAt =
      typeof candidate.fetchedAt === 'number' && Number.isFinite(candidate.fetchedAt)
        ? candidate.fetchedAt
        : 0;
    return bests ? { bests, fetchedAt } : null;
  }
  const legacy = toStoredBestsValue(parsed);
  return legacy ? { bests: legacy, fetchedAt: 0 } : null;
}

export async function saveAthleteBestsBatch(
  bestsByName: Record<string, AthleteBests>,
  fetchedAt: number = Date.now(),
): Promise<void> {
  try {
    const entries = Object.entries(bestsByName)
      .filter(([athleteName]) => normalizeAthleteName(athleteName).length > 0)
      .map(([athleteName, bests]) => [
        getAthleteBestsKey(normalizeAthleteName(athleteName)),
        JSON.stringify({ v: ATHLETE_BESTS_FORMAT_VERSION, fetchedAt, bests }),
      ] as [string, string]);

    await multiSetBatched(entries);
  } catch (error) {
    console.error('Error saving athlete bests:', error);
    throw error;
  }
}

export async function getStoredAthleteBestsForNames(
  athleteNames: readonly string[],
  now: number = Date.now(),
): Promise<Record<string, StoredAthleteBests>> {
  const uniqueNames = Array.from(new Set(athleteNames.filter(Boolean)));
  const keysByName = uniqueNames
    .map((name) => ({ name, normalized: normalizeAthleteName(name) }))
    .filter(({ normalized }) => normalized.length > 0)
    .map(({ name, normalized }) => ({ name, key: getAthleteBestsKey(normalized) }));

  try {
    const payloads = await multiGetBatched(keysByName.map(({ key }) => key));
    const legacyKeys = new Map<string, string>();
    for (const { name, key } of keysByName) {
      if (payloads.get(key)) continue;
      const legacyName = legacyAthleteKeyName(name);
      if (legacyName) legacyKeys.set(name, getAthleteBestsKey(legacyName));
    }
    const legacyPayloads =
      legacyKeys.size > 0
        ? await multiGetBatched(Array.from(legacyKeys.values()))
        : new Map<string, string | null>();
    const byName: Record<string, StoredAthleteBests> = {};
    for (const { name, key } of keysByName) {
      const legacyKey = legacyKeys.get(name);
      const payload = payloads.get(key) ?? (legacyKey ? legacyPayloads.get(legacyKey) : undefined);
      if (!payload) continue;
      const stored = parseStoredAthleteBests(payload);
      if (!stored) continue;
      byName[name] = {
        ...stored,
        isFresh: isAthleteBestsFresh(stored.bests, stored.fetchedAt, now),
      };
    }
    return byName;
  } catch (error) {
    console.error('Error getting cached athlete bests:', error);
    return {};
  }
}
