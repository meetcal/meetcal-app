import { isRecord } from '@/lib/is-record';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName } from '@/data/types/meet';
import type { AthleteBests, AthleteMeetResult } from '@/data/types/athletes';
import { normalizeAthleteName } from '@/lib/athletes';
import { type ApiMeetPackage } from '@/lib/api/meet-package-api';
import { createWriteChain } from '@/lib/data/write-chain';
import { stableSerialize } from '@/lib/data/mutable-resource';
import { readPackageEtags } from './package-etags';

type PackageBests = { snatch_best: number | null; cj_best: number | null; total: number | null };

export function namesWithChangedPackageData(input: {
  results: readonly AthleteMeetResult[];
  storedResults: readonly AthleteMeetResult[];
  yearBests: Readonly<Record<string, PackageBests>>;
  storedBests: Readonly<Record<string, { bests: AthleteBests }>>;
}): Set<string> {
  const rowsByName = (rows: readonly AthleteMeetResult[]) => {
    const byName = new Map<string, string[]>();
    for (const row of rows) {
      const name = normalizeAthleteName(row.name);
      if (!name) continue;
      const list = byName.get(name) ?? [];
      list.push(stableSerialize(row));
      byName.set(name, list);
    }
    const joined = new Map<string, string>();
    for (const [name, list] of byName) joined.set(name, list.sort().join('\n'));
    return joined;
  };
  const fresh = rowsByName(input.results);
  const stored = rowsByName(input.storedResults);
  const changed = new Set<string>();
  for (const [name, rows] of fresh) if (stored.get(name) !== rows) changed.add(name);
  for (const name of stored.keys()) if (!fresh.has(name)) changed.add(name);

  const storedBestsByName = new Map<string, AthleteBests>();
  for (const [name, entry] of Object.entries(input.storedBests)) {
    storedBestsByName.set(normalizeAthleteName(name), entry.bests);
  }
  for (const [name, bests] of Object.entries(input.yearBests)) {
    const normalized = normalizeAthleteName(name);
    if (!normalized) continue;
    const before = storedBestsByName.get(normalized);
    if (
      !before ||
      before.snatch_best !== bests.snatch_best ||
      before.cj_best !== bests.cj_best ||
      before.total !== bests.total
    ) {
      changed.add(normalized);
    }
  }
  return changed;
}

const PACKAGE_BESTS_KEY = '@meet_package_year_bests_v1';

type BestsSnapshot = Record<string, [number, number, number]>;

const packageBestsWrites = createWriteChain();

function isBestsSnapshot(value: unknown): value is BestsSnapshot {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (row) =>
      Array.isArray(row) &&
      row.length === 3 &&
      row.every((n) => typeof n === 'number' && Number.isFinite(n)),
  );
}

async function readPackageBestsSnapshots(): Promise<Record<string, BestsSnapshot>> {
  try {
    const raw = await AsyncStorage.getItem(PACKAGE_BESTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed)) return {};
    const out: Record<string, BestsSnapshot> = {};
    for (const [meet, snapshot] of Object.entries(parsed)) {
      if (isBestsSnapshot(snapshot)) out[meet] = snapshot;
    }
    return out;
  } catch {
    return {};
  }
}

export async function readPackageBestsSnapshot(
  meet: MeetName,
): Promise<Record<string, { bests: AthleteBests }> | null> {
  const snapshot = (await readPackageBestsSnapshots())[meet];
  if (!snapshot) return null;
  const byName: Record<string, { bests: AthleteBests }> = {};
  for (const [name, [snatch, cj, total]] of Object.entries(snapshot)) {
    byName[name] = {
      bests: { snatch_best: snatch || null, cj_best: cj || null, total: total || null },
    };
  }
  return byName;
}

export async function writePackageBestsSnapshot(
  meet: MeetName,
  yearBests: Readonly<Record<string, PackageBests>>,
): Promise<void> {
  const snapshot: BestsSnapshot = {};
  for (const [name, bests] of Object.entries(yearBests)) {
    snapshot[normalizeAthleteName(name)] = [bests.snatch_best ?? 0, bests.cj_best ?? 0, bests.total ?? 0];
  }
  try {
    await packageBestsWrites(async () => {
      const [current, etags] = await Promise.all([readPackageBestsSnapshots(), readPackageEtags()]);
      const next: Record<string, BestsSnapshot> = {};
      for (const [other, value] of Object.entries(current)) {
        if (other !== meet && etags[other] !== undefined) next[other] = value;
      }
      next[meet] = snapshot;
      await AsyncStorage.setItem(PACKAGE_BESTS_KEY, JSON.stringify(next));
    });
  } catch (error) {
    console.warn('Could not record the package year bests:', error);
  }
}

export function packageYearBests(pkg: ApiMeetPackage): Record<string, PackageBests> {
  const yearBests: Record<string, PackageBests> = {};
  for (const [name, bests] of Object.entries(pkg.year_bests_by_name ?? {})) {
    const row = {
      snatch_best: bests.best_snatch > 0 ? bests.best_snatch : null,
      cj_best: bests.best_cj > 0 ? bests.best_cj : null,
      total: bests.best_total > 0 ? bests.best_total : null,
    };
    if (row.snatch_best !== null || row.cj_best !== null || row.total !== null) {
      yearBests[name] = row;
    }
  }
  return yearBests;
}
