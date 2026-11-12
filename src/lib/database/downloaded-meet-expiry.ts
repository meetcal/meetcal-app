import { MeetName } from '@/data/types/meet';
import { meetCalendarDateAnchor } from '@/utils/dateTime';
import { getTrustedNow } from '@/lib/api/server-clock';
import { devLog } from '@/lib/logger';
import { getCachedMeets } from './meets-list-cache';
import { getExplicitMeetDownloads, updateDownloadEndDates } from './meet-downloads-registry';
import { clearMeetData, readStorageKeysForMeetClear } from './meet-data-clears';

const WESTERNMOST_MEET_OFFSET_MS = 12 * 60 * 60 * 1000;

const NOON_TO_NEXT_MIDNIGHT_MS = 12 * 60 * 60 * 1000;

export function hasMeetEnded(endDate: string, now: number): boolean {
  const anchor = meetCalendarDateAnchor(endDate);
  if (!anchor) return false;
  const endOfMeetDay =
    anchor.getTime() + NOON_TO_NEXT_MIDNIGHT_MS + WESTERNMOST_MEET_OFFSET_MS;
  return endOfMeetDay < now;
}

export async function clearExpiredDownloadedMeets(): Promise<void> {
  try {
    const trustedNow = getTrustedNow();
    if (!trustedNow) {
      devLog('Skipping downloaded meet expiry: no server clock sample yet');
      return;
    }
    const now = trustedNow.getTime();
    const downloads = await getExplicitMeetDownloads();
    const downloadedIds = Object.keys(downloads);
    if (downloadedIds.length === 0) return;
    const listedEndDates = new Map<string, string>();
    for (const meet of await getCachedMeets()) {
      if (downloads[meet.name] && meet.dates.end) listedEndDates.set(meet.name, meet.dates.end);
    }
    try {
      await updateDownloadEndDates(listedEndDates);
    } catch (error) {
      console.warn('Could not save downloaded meets\' current end dates:', error);
    }
    const expiredMeetIds = downloadedIds.filter((meetId) => {
      const endDate = listedEndDates.get(meetId) ?? downloads[meetId]?.endDate;
      return endDate ? hasMeetEnded(endDate, now) : false;
    });
    const storageKeys = await readStorageKeysForMeetClear(expiredMeetIds.length);

    for (const meetId of expiredMeetIds) {
      try {
        await clearMeetData(meetId as MeetName, { storageKeys });
      } catch (error) {
        console.error('Error clearing expired downloaded meet:', error);
      }
    }
  } catch (error) {
    console.error('Error clearing expired downloaded meets:', error);
  }
}
