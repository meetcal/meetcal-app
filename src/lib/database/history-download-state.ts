import { isRecord } from '@/lib/is-record';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName } from '@/data/types/meet';
import { normalizeAthleteName } from '@/lib/athletes';
import { createWriteChain } from '@/lib/data/write-chain';

const HISTORY_SYNCED_AT_KEY = '@meet_history_synced_at_v1';

export const HISTORY_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const HISTORY_PENDING_KEY = '@meet_history_pending_v1';

type PendingHistory = { names: string[]; since: number; full?: boolean };

const historyStateWrites = createWriteChain();

export async function readHistorySyncedAt(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_SYNCED_AT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [meet, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[meet] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function pruneHistorySyncedAt(
  stamps: Record<string, number>,
  now: number,
): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [meet, syncedAt] of Object.entries(stamps)) {
    if (now - syncedAt < HISTORY_REFRESH_TTL_MS) kept[meet] = syncedAt;
  }
  return kept;
}

export async function markHistorySynced(meet: MeetName): Promise<void> {
  try {
    await historyStateWrites(async () => {
      const now = Date.now();
      const stamps = pruneHistorySyncedAt(await readHistorySyncedAt(), now);
      stamps[meet] = now;
      await AsyncStorage.setItem(HISTORY_SYNCED_AT_KEY, JSON.stringify(stamps));
    });
  } catch (error) {
    console.warn('Could not record athlete history sync time:', error);
  }
}

export async function readPendingHistory(): Promise<Record<string, PendingHistory>> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed)) return {};
    const out: Record<string, PendingHistory> = {};
    for (const [meet, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      const entry = value;
      if (!Array.isArray(entry.names)) continue;
      if (typeof entry.since !== 'number' || !Number.isFinite(entry.since)) continue;
      const names = entry.names.filter(
        (name): name is string => typeof name === 'string' && name.length > 0,
      );
      out[meet] = { names, since: entry.since, full: entry.full !== false };
    }
    return out;
  } catch {
    return {};
  }
}

export function prunePendingHistory(
  pending: Record<string, PendingHistory>,
  now: number,
): Record<string, PendingHistory> {
  const kept: Record<string, PendingHistory> = {};
  for (const [meet, entry] of Object.entries(pending)) {
    if (now - entry.since < HISTORY_REFRESH_TTL_MS) kept[meet] = entry;
  }
  return kept;
}

export async function writePendingHistory(meet: MeetName, entry: PendingHistory | null): Promise<boolean> {
  try {
    await historyStateWrites(async () => {
      const current = await readPendingHistory();
      if (entry === null && !current[meet]) return;
      const next = prunePendingHistory(current, Date.now());
      if (entry === null) delete next[meet];
      else next[meet] = { names: entry.names, since: entry.since, ...(entry.full === false ? { full: false } : {}) };
      await AsyncStorage.setItem(HISTORY_PENDING_KEY, JSON.stringify(next));
    });
    return true;
  } catch (error) {
    console.warn('Could not record pending athlete history:', error);
    return false;
  }
}

export async function addPendingHistoryNames(meet: MeetName, names: readonly string[]): Promise<boolean> {
  if (names.length === 0) return true;
  try {
    await historyStateWrites(async () => {
      const now = Date.now();
      const next = prunePendingHistory(await readPendingHistory(), now);
      const current = next[meet];
      const merged = Array.from(new Set([...(current?.names ?? []), ...names]));
      const full = current ? current.full !== false : false;
      next[meet] = { names: merged, since: current?.since ?? now, ...(full ? {} : { full: false }) };
      await AsyncStorage.setItem(HISTORY_PENDING_KEY, JSON.stringify(next));
    });
    return true;
  } catch (error) {
    console.warn('Could not record pending athlete history:', error);
    return false;
  }
}

export async function planHistoryDownload(input: {
  rosterNames: readonly string[];
  findMissing: (names: readonly string[]) => Promise<string[]>;
  pending: PendingHistory | undefined;
  syncedAt: number;
  packageChanged: boolean;
  changedNames?: readonly string[] | null;
  force: boolean;
  now: number;
}): Promise<{ names: string[]; fullRefresh: boolean; since: number; track: boolean }> {
  const { rosterNames, pending, now } = input;
  const changedNames = input.packageChanged ? input.changedNames ?? null : null;
  const wholeRoster = { names: [...rosterNames], fullRefresh: true, since: now, track: true };
  if (input.force || (input.packageChanged && changedNames === null)) return wholeRoster;

  const rosterByName = new Map(rosterNames.map((name) => [normalizeAthleteName(name), name]));
  const addOnRoster = (into: Set<string>, names: readonly string[]) => {
    for (const name of names) {
      const onRoster = rosterByName.get(normalizeAthleteName(name));
      if (onRoster) into.add(onRoster);
    }
  };

  const fullSyncDue = now - input.syncedAt >= HISTORY_REFRESH_TTL_MS;
  if (
    pending &&
    now - pending.since < HISTORY_REFRESH_TTL_MS &&
    (pending.full !== false || !fullSyncDue)
  ) {
    const names = new Set<string>();
    addOnRoster(names, pending.names);
    addOnRoster(names, changedNames ?? []);
    for (const name of await input.findMissing(rosterNames)) names.add(name);
    return { names: Array.from(names), fullRefresh: pending.full !== false, since: pending.since, track: true };
  }
  if (fullSyncDue) return wholeRoster;
  if (changedNames !== null) {
    const names = new Set<string>();
    addOnRoster(names, changedNames);
    for (const name of await input.findMissing(rosterNames)) names.add(name);
    return { names: Array.from(names), fullRefresh: false, since: now, track: true };
  }
  return { names: await input.findMissing(rosterNames), fullRefresh: false, since: now, track: false };
}
