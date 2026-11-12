import { MeetName } from '@/data/types/meet';
import type { AthleteMeetResult } from '@/data/types/athletes';
import { normalizeAthleteName } from '@/lib/athletes';
import { findAthleteNamesWithoutHistory, saveAthleteHistoryBatch } from '@/lib/database/athlete-history-store';
import { CONVEX_TRANSIENT_MESSAGE } from '@/lib/api/transport';
import { fetchApiResultsByNames, NAMES_QUERY_CHUNK_SIZE } from '@/lib/api/results-api';
import { MeetCalApiError, MeetCalApiTimeoutError } from '@/lib/api/meetcal-api';
import type { CancelCheck } from './prefetch-requests';
import { markHistorySynced, planHistoryDownload, readHistorySyncedAt, readPendingHistory, writePendingHistory } from './history-download-state';

const HISTORY_DOWNLOAD_BATCH_SIZE = NAMES_QUERY_CHUNK_SIZE;

export const HISTORY_RETRY_AFTER_MAX_MS = 5000;

export const HISTORY_RETRY_AFTER_DEFAULT_MS = 1000;

const HISTORY_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

function isConvexTransientError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof MeetCalApiError) &&
    !(error instanceof MeetCalApiTimeoutError) &&
    CONVEX_TRANSIENT_MESSAGE.test(error.message)
  );
}

export function historyRetryDelayMs(error: unknown): number | null {
  if (isConvexTransientError(error)) return HISTORY_RETRY_AFTER_DEFAULT_MS;
  if (!(error instanceof MeetCalApiError) || !HISTORY_RETRYABLE_STATUSES.has(error.status)) {
    return null;
  }
  const raw = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  const seconds =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return HISTORY_RETRY_AFTER_DEFAULT_MS;
  return Math.min(seconds * 1000, HISTORY_RETRY_AFTER_MAX_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const HISTORY_DEFERRED_RETRY_DELAY_MS = 1000;

async function downloadAthleteHistory(
  meet: MeetName,
  athleteNames: readonly string[],
  throwIfCancelled: CancelCheck,
): Promise<string[]> {
  const failed: string[] = [];
  const deferred: string[][] = [];
  for (let i = 0; i < athleteNames.length; i += HISTORY_DOWNLOAD_BATCH_SIZE) {
    const batch = athleteNames.slice(i, i + HISTORY_DOWNLOAD_BATCH_SIZE);
    const outcome = await downloadHistoryBatch(meet, batch, throwIfCancelled);
    if (outcome === 'network') deferred.push(batch);
    else if (outcome === 'failed') failed.push(...batch);
  }
  if (deferred.length > 0) {
    await wait(HISTORY_DEFERRED_RETRY_DELAY_MS);
    for (const batch of deferred) {
      if ((await downloadHistoryBatch(meet, batch, throwIfCancelled)) !== 'saved') {
        failed.push(...batch);
      }
    }
  }
  return failed;
}

async function downloadHistoryBatch(
  meet: MeetName,
  batch: readonly string[],
  throwIfCancelled: CancelCheck,
): Promise<'saved' | 'network' | 'failed'> {
  throwIfCancelled();
  let batchResults: AthleteMeetResult[];
  try {
    batchResults = await fetchHistoryBatch(batch);
  } catch (historyError) {
    logHistoryBatchFailure(meet, batch, historyError);
    return isNetworkFailure(historyError) ? 'network' : 'failed';
  }

  throwIfCancelled();
  const resultsByName = new Map<string, AthleteMeetResult[]>();
  for (const row of batchResults) {
    const key = normalizeAthleteName(row.name);
    const existing = resultsByName.get(key);
    if (existing) {
      existing.push(row);
    } else {
      resultsByName.set(key, [row]);
    }
  }

  try {
    await saveAthleteHistoryBatch(
      batch.map((name) => ({
        name,
        results: resultsByName.get(normalizeAthleteName(name)) ?? [],
      })),
    );
    return 'saved';
  } catch (historyError) {
    logHistoryBatchFailure(meet, batch, historyError);
    return 'failed';
  }
}

function logHistoryBatchFailure(meet: MeetName, batch: readonly string[], error: unknown): void {
  console.error('Prefetch athlete history batch failed:', {
    meet,
    batchSize: batch.length,
    error,
  });
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof MeetCalApiTimeoutError) return true;
  return !(error instanceof MeetCalApiError) && !isConvexTransientError(error);
}

async function fetchHistoryBatch(batch: readonly string[]): Promise<AthleteMeetResult[]> {
  const names = Array.from(batch);
  try {
    return await fetchApiResultsByNames(names);
  } catch (error) {
    const delayMs = historyRetryDelayMs(error);
    if (delayMs === null) throw error;
    await wait(delayMs);
    return fetchApiResultsByNames(names);
  }
}

export interface HistoryPass {
  names: string[];
  fullRefresh: boolean;
  since: number;
  track: boolean;
  hadPending: boolean;
  recorded: boolean;
}

export async function planAthleteHistory(
  meet: MeetName,
  rosterNames: readonly string[],
  options: { packageChanged: boolean; changedNames?: readonly string[] | null; force: boolean },
): Promise<HistoryPass> {
  const [syncedAtByMeet, pendingByMeet] = await Promise.all([
    readHistorySyncedAt(),
    readPendingHistory(),
  ]);
  const plan = await planHistoryDownload({
    rosterNames,
    findMissing: findAthleteNamesWithoutHistory,
    pending: pendingByMeet[meet],
    syncedAt: syncedAtByMeet[meet] ?? 0,
    packageChanged: options.packageChanged,
    changedNames: options.changedNames,
    force: options.force,
    now: Date.now(),
  });

  const recorded =
    plan.track && plan.names.length > 0
      ? await writePendingHistory(meet, {
          names: plan.names,
          since: plan.since,
          full: plan.fullRefresh,
        })
      : true;
  return { ...plan, hadPending: Boolean(pendingByMeet[meet]), recorded };
}

export async function runAthleteHistory(
  meet: MeetName,
  pass: HistoryPass,
  throwIfCancelled: CancelCheck,
): Promise<boolean> {
  const failed =
    pass.names.length > 0 ? await downloadAthleteHistory(meet, pass.names, throwIfCancelled) : [];
  throwIfCancelled();
  if (failed.length > 0) {
    if (pass.track) {
      await writePendingHistory(meet, { names: failed, since: pass.since, full: pass.fullRefresh });
    }
    return false;
  }
  if (pass.fullRefresh) await markHistorySynced(meet);
  if (pass.hadPending || (pass.track && pass.names.length > 0)) {
    await writePendingHistory(meet, null);
  }
  return true;
}
