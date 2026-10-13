import { qualifyingTotalsResource } from '@/lib/database/fetch-qualifying-totals';
import { standardsResource } from '@/lib/database/fetch-standards';
import { intlRankingsResource } from '@/lib/database/fetchIntlRankings';
import type { MutableResource } from '@/lib/data/mutable-resource';
import { devLog } from '@/lib/logger';
import {
  buildDataWidgetPayloads,
  buildLockedDataWidgetPayloads,
  getDataWidgetWriteCount,
  hasResolvedWidgetFilters,
  isDataWidgetModuleAvailable,
  loadWidgetSettings,
  normalizeWidgetSettings,
  saveWidgetSettings,
  syncDataWidgets,
  type DataWidgetPayloads,
  type DataWidgetSourceData,
  type WidgetSettings,
} from '@/utils/dataWidgets';

/**
 * Keeps the qualifying totals, standards and international rankings widgets
 * current without the Widget Settings screen being open. The app calls
 * `refreshDataWidgets` at launch, on every foreground and whenever the
 * premium entitlement changes; this module bounds what that costs.
 *
 * The tables are premium (each screen is behind `SubscriptionGate`), so the
 * refresh takes the entitlement: a subscriber gets the data, a user without
 * the entitlement gets the "subscribe" payloads (and nothing is fetched), and
 * an entitlement still unknown leaves the widgets as they are.
 */

/** Minimum spacing between background refreshes (launch, foregrounds). */
export const DATA_WIDGET_REFRESH_MIN_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Cached reference data younger than this feeds the widgets without a network
 * request. The tables change a few times a season, so a launch reads the
 * offline cache and only an old copy is revalidated.
 */
export const DATA_WIDGET_SOURCE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type DataWidgetRefreshOutcome =
  /** No native data-widget module (web, Expo Go, tests). Nothing fetched. */
  | 'unavailable'
  /**
   * RevenueCat (or its cache) has not answered yet. Widgets untouched; the
   * caller refreshes again once it does.
   */
  | 'entitlement-unknown'
  /** No premium entitlement: the "subscribe" payloads were written. */
  | 'locked'
  /** A refresh reached the data less than `DATA_WIDGET_REFRESH_MIN_INTERVAL_MS` ago. */
  | 'throttled'
  /** A source could not be read from cache or network. Widgets untouched. */
  | 'no-data'
  /** The stored filters do not resolve against the data. Widgets untouched. */
  | 'unresolved'
  /** Widget Settings wrote while this refresh ran; its write wins. */
  | 'superseded'
  /** The payloads match what this refresher last wrote. */
  | 'unchanged'
  | 'synced';

export interface DataWidgetRefreshDeps {
  now: () => number;
  isAvailable: () => boolean;
  loadSource: (now: number) => Promise<DataWidgetSourceData | null>;
  loadSettings: () => Promise<WidgetSettings>;
  saveSettings: (settings: WidgetSettings) => Promise<void>;
  sync: (payloads: DataWidgetPayloads) => void;
  getWriteCount: () => number;
}

/**
 * When each resource was last confirmed against the network, by resource key.
 * A resource's cache stamp (`lastUpdatedAt`) only moves when the data
 * *changes*, and these tables rarely do, so judging freshness by it alone
 * would refetch all three on every refresh once a copy turned six hours old.
 */
export type SourceCheckLog = Map<string, number>;

/**
 * The cached copy when it is fresh enough, else a revalidation, else whatever
 * stale copy exists. `null` only when there is neither cache nor network.
 */
export async function readWidgetSource<T>(
  resource: MutableResource<T, []>,
  now: number,
  checkLog: SourceCheckLog,
): Promise<T | null> {
  const key = resource.getKey();
  let cached: Awaited<ReturnType<typeof resource.loadCached>> = null;
  try {
    cached = await resource.loadCached();
  } catch {
    cached = null;
  }
  const lastConfirmedAt = Math.max(cached?.lastUpdatedAt ?? 0, checkLog.get(key) ?? 0);
  if (cached && now - lastConfirmedAt < DATA_WIDGET_SOURCE_MAX_AGE_MS) {
    return cached.data;
  }
  try {
    const { data } = await resource.revalidateWithCached(cached);
    checkLog.set(key, now);
    return data;
  } catch {
    return cached?.data ?? null;
  }
}

const sourceCheckLog: SourceCheckLog = new Map();

/**
 * Sequential on purpose: three small reference tables, read one at a time so
 * a launch never stacks three requests on top of the screen's own.
 */
async function loadDefaultSource(now: number): Promise<DataWidgetSourceData | null> {
  const totalsData = await readWidgetSource(qualifyingTotalsResource, now, sourceCheckLog);
  if (!totalsData) return null;
  const standardsData = await readWidgetSource(standardsResource, now, sourceCheckLog);
  if (!standardsData) return null;
  const intlRankings = await readWidgetSource(intlRankingsResource, now, sourceCheckLog);
  if (!intlRankings) return null;
  return { totalsData, standardsData, intlRankings };
}

export function createDataWidgetRefresher(deps: DataWidgetRefreshDeps) {
  let inFlight: Promise<DataWidgetRefreshOutcome> | null = null;
  let inFlightEntitlement: boolean | null = null;
  let lastStartedAt: number | null = null;
  let lastEntitlement: boolean | null = null;
  /** The newest answer a caller asked for; a queued run for an older one is dropped. */
  let latestEntitlement: boolean | null = null;
  let lastWrite: { signature: string; writeCount: number } | null = null;

  /** True when these exact payloads are what this refresher last wrote. */
  const isLastWrite = (signature: string) =>
    lastWrite !== null &&
    lastWrite.signature === signature &&
    lastWrite.writeCount === deps.getWriteCount();

  const write = (payloads: DataWidgetPayloads, signature: string) => {
    deps.sync(payloads);
    lastWrite = { signature, writeCount: deps.getWriteCount() };
  };

  const runLocked = async (): Promise<DataWidgetRefreshOutcome> => {
    const payloads = buildLockedDataWidgetPayloads();
    const signature = JSON.stringify(payloads);
    if (isLastWrite(signature)) return 'unchanged';
    write(payloads, signature);
    return 'locked';
  };

  const run = async (): Promise<DataWidgetRefreshOutcome> => {
    const writeCountAtStart = deps.getWriteCount();
    const source = await deps.loadSource(deps.now());
    if (!source) return 'no-data';

    const stored = await deps.loadSettings();
    const settings = normalizeWidgetSettings(
      stored,
      source.totalsData,
      source.intlRankings,
    );
    if (
      !hasResolvedWidgetFilters(
        settings,
        source.totalsData,
        source.standardsData,
        source.intlRankings,
      )
    ) {
      return 'unresolved';
    }

    if (deps.getWriteCount() !== writeCountAtStart) return 'superseded';

    const payloads = buildDataWidgetPayloads(source, settings);
    const signature = JSON.stringify(payloads);
    if (isLastWrite(signature)) return 'unchanged';

    // Persist healed filters first, as the settings screen does, so the screen
    // and the widget never disagree about what is selected.
    if (settings !== stored) await deps.saveSettings(settings);
    if (deps.getWriteCount() !== writeCountAtStart) return 'superseded';

    write(payloads, signature);
    return 'synced';
  };

  /**
   * Never rejects. `isSubscribed` is the app's current entitlement answer
   * (`useSubscription().isSubscribed`). Concurrent callers with the same
   * answer share one run; calls within `DATA_WIDGET_REFRESH_MIN_INTERVAL_MS`
   * of the last run that reached the data are skipped unless the answer
   * changed since (a purchase, an expiry), which runs at once, after any run
   * in flight. A run that found no data (no cache and no network, or a
   * storage error) does not hold back the next foreground.
   */
  const refresh = (isSubscribed: boolean | null): Promise<DataWidgetRefreshOutcome> => {
    if (!deps.isAvailable()) return Promise.resolve('unavailable');
    if (isSubscribed === null) return Promise.resolve('entitlement-unknown');
    latestEntitlement = isSubscribed;
    if (inFlight) {
      if (inFlightEntitlement === isSubscribed) return inFlight;
      // Queued behind the run in flight, and dropped if the answer changed
      // again meanwhile (true -> false -> true must not end on "locked").
      return inFlight.then(() =>
        latestEntitlement === isSubscribed ? refresh(isSubscribed) : ('superseded' as const),
      );
    }
    const now = deps.now();
    if (
      lastEntitlement === isSubscribed &&
      lastStartedAt !== null &&
      now - lastStartedAt < DATA_WIDGET_REFRESH_MIN_INTERVAL_MS
    ) {
      return Promise.resolve('throttled');
    }
    lastStartedAt = now;
    lastEntitlement = isSubscribed;
    inFlightEntitlement = isSubscribed;
    inFlight = (isSubscribed ? run() : runLocked())
      .catch((error: unknown) => {
        console.warn('[Widget] Data widget refresh failed', error);
        return 'no-data' as const;
      })
      .then((outcome) => {
        if (outcome === 'no-data') lastStartedAt = null;
        devLog(`[Widget] Data widget refresh: ${outcome}`);
        return outcome;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return { refresh };
}

const defaultRefresher = createDataWidgetRefresher({
  now: () => Date.now(),
  isAvailable: isDataWidgetModuleAvailable,
  loadSource: loadDefaultSource,
  loadSettings: loadWidgetSettings,
  saveSettings: saveWidgetSettings,
  sync: syncDataWidgets,
  getWriteCount: getDataWidgetWriteCount,
});

/**
 * Rebuilds the data widgets from the stored settings for a subscriber, or
 * writes the "subscribe" payloads for anyone else. See module comment.
 */
export function refreshDataWidgets(
  isSubscribed: boolean | null,
): Promise<DataWidgetRefreshOutcome> {
  return defaultRefresher.refresh(isSubscribed);
}
