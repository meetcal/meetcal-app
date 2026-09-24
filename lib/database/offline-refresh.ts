import { isNetworkAvailable } from '@/lib/networkUtils';
import { prefetchMeetData } from './meet-manager';
import { markMeetExplicitlyDownloaded } from './offline-store';

/**
 * "Refresh All" for offline downloads, as download-then-swap.
 *
 * The old refresh deleted every download first and re-downloaded second. Any
 * failure in between — an API error, a timeout, the connection dropping
 * mid-refresh — left the user with less offline data than they started with,
 * and a meet whose re-download failed also lost its "downloaded" mark. A
 * failed delete step was swallowed, so the screen could still say
 * "Refresh Complete".
 *
 * Here nothing is deleted. Each item is re-fetched and written over its own
 * stored copy only once the fresh copy has arrived (`download*ForOffline`
 * write the whole blob once; `prefetchMeetData` writes over the meet in place
 * after the package arrived), so a failed item keeps its previous copy and a
 * succeeded one is replaced. Items run one at a time: the meet prefetch
 * inflates athlete history and must stay sequential.
 */

export type RefreshableDownload = {
  id: string;
  title: string;
  /** Fetches fresh and stores it, or rejects leaving the stored copy alone. */
  download: () => Promise<void>;
};

export type RefreshableMeet = {
  name: string;
  endDate?: string | null;
};

export type OfflineRefreshResult =
  | { status: 'offline' }
  | {
      status: 'done';
      /** Titles refreshed, in order. */
      refreshed: string[];
      /** Titles not refreshed (failed or skipped); their old copies remain. */
      failed: string[];
      /** The connection dropped part way; the rest were skipped, not tried. */
      connectionLost: boolean;
    };

/** Most failed item names listed in the alert before "and N more". */
export const REFRESH_FAILURES_LISTED = 5;

type RefreshStep = { title: string; run: () => Promise<void> };

export async function refreshOfflineDownloads(
  items: readonly RefreshableDownload[],
  meets: readonly RefreshableMeet[],
): Promise<OfflineRefreshResult> {
  if (!(await isNetworkAvailable())) {
    return { status: 'offline' };
  }

  const steps: RefreshStep[] = [
    ...items.map((item) => ({ title: item.title, run: item.download })),
    ...meets.map((meet) => ({
      title: meet.name,
      run: async () => {
        await prefetchMeetData(meet.name, { forceHistoryRefresh: true });
        // Already marked (it is only refreshed because it was downloaded);
        // re-marking picks up a changed end date for expiry.
        await markMeetExplicitlyDownloaded(meet.name, true, {
          endDate: meet.endDate ?? undefined,
        });
      },
    })),
  ];

  const refreshed: string[] = [];
  const failed: string[] = [];
  let connectionLost = false;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    try {
      await step.run();
      refreshed.push(step.title);
    } catch (error) {
      console.error('Offline refresh item failed; previous copy kept:', {
        item: step.title,
        error,
      });
      failed.push(step.title);
      // Without this every remaining meet waits out its own request timeout
      // before failing the same way.
      if (!(await isNetworkAvailable())) {
        connectionLost = true;
        for (const skipped of steps.slice(index + 1)) {
          failed.push(skipped.title);
        }
        break;
      }
    }
  }

  return { status: 'done', refreshed, failed, connectionLost };
}

function listTitles(titles: readonly string[]): string {
  const shown = titles.slice(0, REFRESH_FAILURES_LISTED);
  const hidden = titles.length - shown.length;
  return hidden > 0 ? `${shown.join(', ')} and ${hidden} more` : shown.join(', ');
}

/** The alert for a refresh outcome. Never "Refresh Complete" unless all of it was. */
export function describeOfflineRefresh(result: OfflineRefreshResult): {
  title: string;
  message: string;
} {
  if (result.status === 'offline') {
    return {
      title: "You're Offline",
      message: 'Connect to the internet to refresh. Your downloaded data has been kept.',
    };
  }

  const { refreshed, failed, connectionLost } = result;
  if (failed.length === 0) {
    if (refreshed.length === 0) {
      return {
        title: 'Nothing to Refresh',
        message: "You haven't downloaded anything for offline use yet.",
      };
    }
    return { title: 'Refresh Complete', message: 'All downloaded data has been refreshed.' };
  }

  const lead = connectionLost ? 'The connection was lost. ' : '';
  const kept = `Couldn't refresh ${listTitles(failed)}. ${
    failed.length === 1 ? 'Your previous copy is' : 'Your previous copies are'
  } still on this device.`;
  if (refreshed.length === 0) {
    return {
      title: 'Refresh Failed',
      message: `${lead}${kept} Please check your connection and try again.`,
    };
  }
  return { title: 'Refresh Incomplete', message: `${lead}${kept}` };
}
