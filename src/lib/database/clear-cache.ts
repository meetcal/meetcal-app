import { clearCachedMeetsList } from '@/lib/database/meet-manager';
import { claimOfflineBulk, releaseOfflineBulk } from '@/lib/database/offline-activity';
import { clearBrowseCaches } from '@/lib/database/offline-cache';
import { refreshOfflineDownloads } from '@/lib/database/offline-refresh';
import {
  clearAllAthleteHistory,
  clearAllMeetData,
  getExplicitMeetDownloadEntries,
  hasMeetEnded,
} from '@/lib/database/offline-store';
import { getTrustedNow } from '@/lib/api/meetcal-api';
import { isNetworkAvailable } from '@/lib/networkUtils';

export type ClearCacheOutcome =
  | { status: 'cleared' }
  /** Nothing was touched: the device is offline. */
  | { status: 'offline' }
  /** Nothing was touched: an Offline Data download, removal or bulk action is running. */
  | { status: 'busy' }
  /** The cache was cleared but re-downloading failed. */
  | { status: 'refresh-failed'; error: unknown }
  /** Cleared and refreshed, but these offline downloads could not be re-downloaded. */
  | { status: 'downloads-failed'; failed: string[] }
  /** Some meets' cached data could not be removed (the rest ran as usual). */
  | { status: 'clear-incomplete'; failed: number };

export interface ClearCacheDeps {
  /** Re-fetch the meets list. Must reject when it could not. */
  refreshAvailableMeets: () => Promise<void>;
  /**
   * Re-sync the selected meet. Must reject when it could not. Runs after the
   * offline downloads are back, so a downloaded selected meet is one already.
   */
  refreshSelectedMeet: () => Promise<void>;
}

/**
 * The profile screen's "Clear Cache": drop every cached meet, all athlete
 * history, the browse caches (rankings, clubs, WSO views) and the cached meets
 * list, then download fresh copies: the meets list, every meet the user had
 * downloaded for offline use (re-marked downloaded, with its end date), and
 * the selected meet.
 *
 * Downloads used to be wiped and never restored: a second meet downloaded
 * for a trip was simply gone, and the selected one came back unmarked (no
 * expiry date, no background refresh, open to LRU eviction).
 *
 * This used to run in the screen with no guards. Offline, it deleted every
 * download and then reported success because both refreshes swallowed their
 * errors, leaving the user with nothing at the meet. It also ignored the
 * Offline Data screen's activity lock, so a Refresh All still running in the
 * background wrote meets back mid-clear and re-marked them downloaded.
 *
 * Refuses before touching anything when offline or when another offline
 * action holds the lock; holds the `delete` bulk claim for the whole run; and
 * reports success only when every meet was cleared and everything came back.
 * Each refresh is tried whatever the others did: the downloads are fetched
 * by name, so a failed meets-list request no longer leaves them deleted.
 */
export async function clearCachedMeetData(deps: ClearCacheDeps): Promise<ClearCacheOutcome> {
  if (!(await isNetworkAvailable())) return { status: 'offline' };

  if (claimOfflineBulk('delete') !== 'claimed') return { status: 'busy' };
  try {
    // Read before the clear un-marks them. A meet that has ended (on the
    // server's clock, as the expiry sweep judges it) is not brought back.
    const now = getTrustedNow()?.getTime();
    const downloads = (await getExplicitMeetDownloadEntries()).filter(
      ({ endDate }) => !(now !== undefined && endDate && hasMeetEnded(endDate, now)),
    );
    const { failed: notCleared } = await clearAllMeetData();
    await clearAllAthleteHistory();
    await clearCachedMeetsList();
    await clearBrowseCaches();

    let refreshError: { error: unknown } | null = null;
    try {
      await deps.refreshAvailableMeets();
    } catch (error) {
      refreshError = { error };
    }
    let failedDownloads: string[] = [];
    if (downloads.length > 0) {
      try {
        const refreshed = await refreshOfflineDownloads(
          [],
          downloads.map(({ meet, endDate }) => ({ name: meet, endDate })),
        );
        failedDownloads =
          refreshed.status === 'offline' ? downloads.map(({ meet }) => meet) : refreshed.failed;
      } catch (error) {
        console.error('Clear Cache could not re-download offline meets:', error);
        failedDownloads = downloads.map(({ meet }) => meet);
      }
    }
    try {
      await deps.refreshSelectedMeet();
    } catch (error) {
      refreshError ??= { error };
    }

    if (notCleared > 0) return { status: 'clear-incomplete', failed: notCleared };
    if (failedDownloads.length > 0) return { status: 'downloads-failed', failed: failedDownloads };
    if (refreshError) return { status: 'refresh-failed', error: refreshError.error };
    return { status: 'cleared' };
  } finally {
    releaseOfflineBulk('delete');
  }
}

/** What the user is told for each outcome. */
export function clearCacheToast(outcome: ClearCacheOutcome): {
  type: 'success' | 'error';
  message: string;
} {
  switch (outcome.status) {
    case 'cleared':
      return { type: 'success', message: 'Cached meet data has been cleared and refreshed.' };
    case 'offline':
      return {
        type: 'error',
        message: 'You are offline. Connect to the internet to clear and re-download cached meet data.',
      };
    case 'busy':
      return {
        type: 'error',
        message: 'Offline data is still downloading or being removed. Try again when it finishes.',
      };
    case 'refresh-failed':
      return {
        type: 'error',
        message: 'Cache cleared, but fresh meet data could not be downloaded. Pull to refresh or try again.',
      };
    case 'clear-incomplete':
      return {
        type: 'error',
        message: 'Some cached meet data could not be cleared. Try Clear Cache again.',
      };
    case 'downloads-failed':
      return {
        type: 'error',
        message: `Cache cleared, but ${outcome.failed.length === 1 ? 'an offline download' : `${outcome.failed.length} offline downloads`} could not be re-downloaded. Download ${outcome.failed.length === 1 ? 'it' : 'them'} again from Offline Data.`,
      };
  }
}
