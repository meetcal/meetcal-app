import { qualifyingTotalsResource } from '@/lib/database/fetch-qualifying-totals';
import { standardsResource } from '@/lib/database/fetch-standards';
import { intlRankingsResource } from '@/lib/database/fetchIntlRankings';
import type { MutableResource } from '@/lib/data/mutable-resource';
import { devLog } from '@/lib/logger';
import {
  buildDataWidgetPayloads,
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
 * `refreshDataWidgets` at launch and on every foreground; this module bounds
 * what that costs.
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
  /** A refresh ran less than `DATA_WIDGET_REFRESH_MIN_INTERVAL_MS` ago. */
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
 * The cached copy when it is fresh enough, else a revalidation, else whatever
 * stale copy exists. `null` only when there is neither cache nor network.
 */
export async function readWidgetSource<T>(
  resource: MutableResource<T, []>,
  now: number,
): Promise<T | null> {
  let cached: Awaited<ReturnType<typeof resource.loadCached>> = null;
  try {
    cached = await resource.loadCached();
  } catch {
    cached = null;
  }
  if (
    cached &&
    cached.lastUpdatedAt !== null &&
    now - cached.lastUpdatedAt < DATA_WIDGET_SOURCE_MAX_AGE_MS
  ) {
    return cached.data;
  }
  try {
    return (await resource.revalidateWithCached(cached)).data;
  } catch {
    return cached?.data ?? null;
  }
}

/**
 * Sequential on purpose: three small reference tables, read one at a time so
 * a launch never stacks three requests on top of the screen's own.
 */
async function loadDefaultSource(now: number): Promise<DataWidgetSourceData | null> {
  const totalsData = await readWidgetSource(qualifyingTotalsResource, now);
  if (!totalsData) return null;
  const standardsData = await readWidgetSource(standardsResource, now);
  if (!standardsData) return null;
  const intlRankings = await readWidgetSource(intlRankingsResource, now);
  if (!intlRankings) return null;
  return { totalsData, standardsData, intlRankings };
}

export function createDataWidgetRefresher(deps: DataWidgetRefreshDeps) {
  let inFlight: Promise<DataWidgetRefreshOutcome> | null = null;
  let lastStartedAt: number | null = null;
  let lastWrite: { signature: string; writeCount: number } | null = null;

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
    if (
      lastWrite &&
      lastWrite.signature === signature &&
      lastWrite.writeCount === deps.getWriteCount()
    ) {
      return 'unchanged';
    }

    // Persist healed filters first, as the settings screen does, so the screen
    // and the widget never disagree about what is selected.
    if (settings !== stored) await deps.saveSettings(settings);
    if (deps.getWriteCount() !== writeCountAtStart) return 'superseded';

    deps.sync(payloads);
    lastWrite = { signature, writeCount: deps.getWriteCount() };
    return 'synced';
  };

  /**
   * Never rejects. Concurrent callers share one run; calls within
   * `DATA_WIDGET_REFRESH_MIN_INTERVAL_MS` of the last start are skipped.
   */
  const refresh = (): Promise<DataWidgetRefreshOutcome> => {
    if (!deps.isAvailable()) return Promise.resolve('unavailable');
    if (inFlight) return inFlight;
    const now = deps.now();
    if (
      lastStartedAt !== null &&
      now - lastStartedAt < DATA_WIDGET_REFRESH_MIN_INTERVAL_MS
    ) {
      return Promise.resolve('throttled');
    }
    lastStartedAt = now;
    inFlight = run()
      .catch((error: unknown) => {
        console.warn('[Widget] Data widget refresh failed', error);
        return 'no-data' as const;
      })
      .then((outcome) => {
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

/** Rebuilds the data widgets from the stored settings. See module comment. */
export function refreshDataWidgets(): Promise<DataWidgetRefreshOutcome> {
  return defaultRefresher.refresh();
}
