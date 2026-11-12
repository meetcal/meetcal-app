import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AthleteMeetResult } from '@/data/types/athletes';
import { Buffer } from 'buffer';
import { deflate, inflate } from 'pako';
import { multiGetBatched, multiRemoveBatched, multiSetBatched } from './storage-batches';
import { LIFTING_RESULTS_CHUNK_MARKER } from './offline-storage-keys';

const LIFTING_RESULTS_CHUNK_SIZE = 180_000;

const MAX_LIFTING_RESULTS_CHUNKS = 256;

const LIFTING_RESULTS_FORMAT = 'deflate-base64-chunks-v1';

interface LiftingResultsManifest {
  format: typeof LIFTING_RESULTS_FORMAT;
  chunks: number;
  generation?: number;
}

function getLiftingResultsChunkKey(
  baseKey: string,
  index: number,
  generation = 0,
): string {
  return generation === 0
    ? `${baseKey}${LIFTING_RESULTS_CHUNK_MARKER}${index}`
    : `${baseKey}${LIFTING_RESULTS_CHUNK_MARKER}${index}_g${generation}`;
}

function getManifestChunkKeys(baseKey: string, manifest: LiftingResultsManifest): string[] {
  const generation = manifest.generation ?? 0;
  return Array.from({ length: manifest.chunks }, (_, index) =>
    getLiftingResultsChunkKey(baseKey, index, generation),
  );
}

function isLiftingResultsManifest(value: unknown): value is LiftingResultsManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { format?: unknown; chunks?: unknown; generation?: unknown };
  return (
    candidate.format === LIFTING_RESULTS_FORMAT &&
    isBoundedChunkCount(candidate.chunks) &&
    (candidate.generation === undefined || isChunkGeneration(candidate.generation))
  );
}

function isChunkGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseLiftingResultsManifest(payload: string | null): LiftingResultsManifest | null {
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isLiftingResultsManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isBoundedChunkCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_LIFTING_RESULTS_CHUNKS
  );
}

function isCachedLiftResult(value: unknown): value is AthleteMeetResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function toCachedLiftResults(rows: readonly unknown[]): AthleteMeetResult[] {
  const valid = rows.filter(isCachedLiftResult);
  if (valid.length !== rows.length) {
    console.warn(
      `Dropped ${rows.length - valid.length} malformed cached lifting result rows`,
    );
  }
  return valid.map(withoutTheIdOlderBuildsStored);
}

function withoutTheIdOlderBuildsStored(row: AthleteMeetResult): AthleteMeetResult {
  if (!('id' in row)) return row;
  const { id: _storedByOlderBuilds, ...current } = row as AthleteMeetResult & { id?: unknown };
  return current;
}

function splitIntoChunks(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }
  return chunks;
}

function encodeLiftingResults(results: AthleteMeetResult[]): string {
  const json = JSON.stringify(results);
  const compressed = deflate(json);
  return Buffer.from(compressed).toString('base64');
}

function decodeLiftingResults(encoded: string): AthleteMeetResult[] {
  const bytes = Buffer.from(encoded, 'base64');
  const inflated = inflate(bytes);
  const json = Buffer.from(inflated).toString();
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('Cached lifting results payload was not an array');
  }
  return toCachedLiftResults(parsed);
}

export async function clearStoredLiftingResultsValue(liftingResultsKey: string): Promise<void> {
  const current = await AsyncStorage.getItem(liftingResultsKey);
  if (!current) {
    return;
  }

  const manifest = parseLiftingResultsManifest(current);
  if (manifest) {
    await multiRemoveBatched([
      liftingResultsKey,
      ...getManifestChunkKeys(liftingResultsKey, manifest),
    ]);
    return;
  }

  await AsyncStorage.removeItem(liftingResultsKey);
}

export async function readStoredLiftingResults(
  liftingResultsKey: string,
): Promise<AthleteMeetResult[]> {
  const payload = await AsyncStorage.getItem(liftingResultsKey);
  if (!payload) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(payload);

    if (Array.isArray(parsed)) {
      return toCachedLiftResults(parsed);
    }

    if (!isLiftingResultsManifest(parsed) || parsed.chunks <= 0) {
      return [];
    }

    const chunkKeys = getManifestChunkKeys(liftingResultsKey, parsed);
    const chunkEntries = await AsyncStorage.multiGet(chunkKeys);
    const chunkValues = chunkEntries.map(([, value]) => value ?? '');

    const emptyChunks = chunkValues.filter((v) => v.length === 0).length;
    if (emptyChunks > 0) {
      return [];
    }

    return decodeLiftingResults(chunkValues.join(''));
  } catch (error) {
    console.error('Error reading stored lifting results:', error);
    return [];
  }
}

export type LiftingResultsWrite = {
  key: string;
  results: AthleteMeetResult[];
};

type PreviousLiftingResults =
  | { kind: 'absent' }
  | { kind: 'kept'; payload: string }
  | { kind: 'unverified'; payload: string };

type PlannedLiftingResultsWrite = {
  key: string;
  previous: PreviousLiftingResults;
  previousChunkKeys: string[];
  chunkKeys: string[];
  chunks: string[];
  manifestPayload: string;
};

type ListedLiftingResultsChunks = { chunkKeys: string[]; generations: Set<number> };

function listLiftingResultsChunks(
  storageKeys: readonly string[],
  baseKeys: readonly string[],
): Map<string, ListedLiftingResultsChunks> {
  const listed = new Map<string, ListedLiftingResultsChunks>(
    baseKeys.map((baseKey) => [baseKey, { chunkKeys: [], generations: new Set() }]),
  );
  for (const key of storageKeys) {
    const chunkAt = key.lastIndexOf(LIFTING_RESULTS_CHUNK_MARKER);
    if (chunkAt === -1) continue;
    const entry = listed.get(key.slice(0, chunkAt));
    const match = /^\d+(?:_g(\d+))?$/.exec(key.slice(chunkAt + LIFTING_RESULTS_CHUNK_MARKER.length));
    if (!entry || !match) continue;
    const generation = match[1] === undefined ? 0 : Number(match[1]);
    if (!isChunkGeneration(generation)) continue;
    entry.chunkKeys.push(key);
    entry.generations.add(generation);
  }
  return listed;
}

function isStoredChunk(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9+/]+=*$/.test(value);
}

function nextChunkGeneration(taken: ReadonlySet<number>): number {
  let highest = -1;
  for (const generation of taken) highest = Math.max(highest, generation);
  if (isChunkGeneration(highest + 1)) return highest + 1;
  let generation = 1;
  while (taken.has(generation)) generation += 1;
  return generation;
}

export async function writeStoredLiftingResultsBatch(
  writes: readonly LiftingResultsWrite[],
): Promise<number> {
  if (writes.length === 0) return 0;
  const keys = writes.map((write) => write.key);
  const previousPayloads = await multiGetBatched(keys);

  const encodedByKey = new Map<string, string>();
  const previousManifests = new Map<string, LiftingResultsManifest>();
  const previousChunkKeys: string[] = [];
  const unverifiedKeys: string[] = [];
  for (const write of writes) {
    encodedByKey.set(write.key, encodeLiftingResults(write.results));
    const payload = previousPayloads.get(write.key) ?? null;
    const previous = parseLiftingResultsManifest(payload);
    if (previous) {
      previousManifests.set(write.key, previous);
      previousChunkKeys.push(...getManifestChunkKeys(write.key, previous));
    } else if (payload !== null) {
      unverifiedKeys.push(write.key);
    }
  }
  const listedChunks =
    unverifiedKeys.length > 0
      ? listLiftingResultsChunks(await AsyncStorage.getAllKeys(), unverifiedKeys)
      : new Map<string, ListedLiftingResultsChunks>();
  for (const listed of listedChunks.values()) previousChunkKeys.push(...listed.chunkKeys);

  const previousChunks = await multiGetBatched(previousChunkKeys);
  const planned: PlannedLiftingResultsWrite[] = [];
  for (const write of writes) {
    const encoded = encodedByKey.get(write.key) ?? '';
    const previous = previousManifests.get(write.key) ?? null;
    const listed = listedChunks.get(write.key);
    const oldChunkKeys = previous
      ? getManifestChunkKeys(write.key, previous)
      : (listed?.chunkKeys ?? []).filter((chunkKey) => isStoredChunk(previousChunks.get(chunkKey)));
    if (previous) {
      const oldChunks = oldChunkKeys.map((chunkKey) => previousChunks.get(chunkKey));
      if (oldChunks.every((chunk) => typeof chunk === 'string') && oldChunks.join('') === encoded) {
        continue;
      }
    }
    const chunks = splitIntoChunks(encoded, LIFTING_RESULTS_CHUNK_SIZE);
    if (chunks.length > MAX_LIFTING_RESULTS_CHUNKS) {
      throw new Error(
        `Lifting results for ${write.key} need ${chunks.length} chunks (max ${MAX_LIFTING_RESULTS_CHUNKS})`,
      );
    }
    const generation = nextChunkGeneration(
      previous ? new Set([previous.generation ?? 0]) : (listed?.generations ?? new Set()),
    );
    const manifest: LiftingResultsManifest = {
      format: LIFTING_RESULTS_FORMAT,
      chunks: chunks.length,
      ...(generation > 0 ? { generation } : {}),
    };
    planned.push({
      key: write.key,
      previous: previous
        ? { kind: 'kept', payload: previousPayloads.get(write.key) ?? '' }
        : listed
          ? { kind: 'unverified', payload: previousPayloads.get(write.key) ?? '' }
          : { kind: 'absent' },
      previousChunkKeys: oldChunkKeys,
      chunkKeys: chunks.map((_, index) =>
        getLiftingResultsChunkKey(write.key, index, generation),
      ),
      chunks,
      manifestPayload: JSON.stringify(manifest),
    });
  }
  if (planned.length === 0) return 0;

  const pairs: [string, string][] = [];
  for (const plan of planned) {
    plan.chunkKeys.forEach((chunkKey, index) => pairs.push([chunkKey, plan.chunks[index]]));
  }
  for (const plan of planned) {
    pairs.push([plan.key, plan.manifestPayload]);
  }

  try {
    await multiSetBatched(pairs);
    const written = await multiGetBatched(
      planned.flatMap((plan) => [...plan.chunkKeys, plan.key]),
    );
    for (const plan of planned) {
      const missingChunk = plan.chunkKeys.findIndex((chunkKey) => !written.get(chunkKey));
      if (missingChunk !== -1) {
        throw new Error(`Chunk ${missingChunk} failed to persist for ${plan.key}`);
      }
      if (written.get(plan.key) !== plan.manifestPayload) {
        throw new Error(`Manifest failed to persist for ${plan.key}`);
      }
    }
  } catch (error) {
    await restorePreviousManifests(planned);
    throw error;
  }

  const currentChunkKeys = new Set(planned.flatMap((plan) => plan.chunkKeys));
  await multiRemoveBatched(
    planned.flatMap((plan) =>
      plan.previousChunkKeys.filter((chunkKey) => !currentChunkKeys.has(chunkKey)),
    ),
  );
  return planned.length;
}

async function restorePreviousManifests(planned: readonly PlannedLiftingResultsWrite[]): Promise<void> {
  const restore: [string, string][] = [];
  const remove: string[] = [];
  for (const plan of planned) {
    if (plan.previous.kind === 'kept') restore.push([plan.key, plan.previous.payload]);
    else if (plan.previous.kind === 'absent') remove.push(plan.key);
  }
  try {
    await multiSetBatched(restore);
    await multiRemoveBatched(remove);
  } catch (restoreError) {
    console.error('Could not restore previous lifting results manifests:', restoreError);
  }
  try {
    await multiSetBatched(await unverifiedRewritesToUndo(planned));
  } catch (restoreError) {
    console.error('Could not restore previous lifting results payloads:', restoreError);
  }
}

async function unverifiedRewritesToUndo(
  planned: readonly PlannedLiftingResultsWrite[],
): Promise<[string, string][]> {
  const unverified: { plan: PlannedLiftingResultsWrite; payload: string }[] = [];
  for (const plan of planned) {
    if (plan.previous.kind === 'unverified') unverified.push({ plan, payload: plan.previous.payload });
  }
  if (unverified.length === 0) return [];
  const current = await multiGetBatched(
    unverified.flatMap(({ plan }) => [...plan.chunkKeys, plan.key]),
  );
  return unverified
    .filter(
      ({ plan }) =>
        current.get(plan.key) === plan.manifestPayload &&
        plan.chunkKeys.some((chunkKey) => !current.get(chunkKey)),
    )
    .map(({ plan, payload }): [string, string] => [plan.key, payload]);
}

export async function writeStoredLiftingResults(
  liftingResultsKey: string,
  liftingResults: AthleteMeetResult[],
): Promise<void> {
  await writeStoredLiftingResultsBatch([{ key: liftingResultsKey, results: liftingResults }]);
}
