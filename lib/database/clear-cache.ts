import { clearCachedMeetsList } from '@/lib/database/meet-manager';
import { claimOfflineBulk, releaseOfflineBulk } from '@/lib/database/offline-activity';
import { clearBrowseCaches } from '@/lib/database/offline-cache';
import { clearAllAthleteHistory, clearAllMeetData } from '@/lib/database/offline-store';
import { isNetworkAvailable } from '@/lib/networkUtils';

export type ClearCacheOutcome =
  | { status: 'cleared' }
  /** Nothing was touched: the device is offline. */
  | { status: 'offline' }
  /** Nothing was touched: an Offline Data download, removal or bulk action is running. */
  | { status: 'busy' }
  /** The cache was cleared but re-downloading failed. */
  | { status: 'refresh-failed'; error: unknown };

export interface ClearCacheDeps {
  /** Re-fetch the meets list. Must reject when it could not. */
  refreshAvailableMeets: () => Promise<void>;
  /** Re-download the selected meet. Must reject when it could not. */
  refreshSelectedMeet: () => Promise<void>;
}

/**
 * The profile screen's "Clear Cache": drop every downloaded meet, all athlete
 * history, the browse caches (rankings, clubs, WSO views) and the cached meets
 * list, then download fresh copies.
 *
 * This used to run in the screen with no guards. Offline, it deleted every
 * download and then reported success because both refreshes swallowed their
 * errors, leaving the user with nothing at the meet. It also ignored the
 * Offline Data screen's activity lock, so a Refresh All still running in the
 * background wrote meets back mid-clear and re-marked them downloaded.
 *
 * Refuses before touching anything when offline or when another offline
 * action holds the lock; holds the `delete` bulk claim for the whole run; and
 * reports success only when both refreshes resolved.
 */
export async function clearCachedMeetData(deps: ClearCacheDeps): Promise<ClearCacheOutcome> {
  if (!(await isNetworkAvailable())) return { status: 'offline' };

  if (claimOfflineBulk('delete') !== 'claimed') return { status: 'busy' };
  try {
    await clearAllMeetData();
    await clearAllAthleteHistory();
    await clearCachedMeetsList();
    await clearBrowseCaches();

    try {
      await deps.refreshAvailableMeets();
      await deps.refreshSelectedMeet();
    } catch (error) {
      return { status: 'refresh-failed', error };
    }
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
  }
}
