import { isRecord } from '@/lib/is-record';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName } from '@/data/types/meet';
import { createWriteChain } from '@/lib/data/write-chain';

const EXPLICIT_MEET_DOWNLOADS_KEY = 'meetcal_explicit_meet_downloads';

type ExplicitMeetDownloadEntry = {
  markedAt: number;
  endDate?: string;
};

type ExplicitMeetDownloads = Record<string, ExplicitMeetDownloadEntry>;

export async function getExplicitMeetDownloads(): Promise<ExplicitMeetDownloads> {
  try {
    const raw = await AsyncStorage.getItem(EXPLICIT_MEET_DOWNLOADS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return parsed.reduce<ExplicitMeetDownloads>((acc, value) => {
        if (typeof value !== 'string') return acc;
        acc[value] = { markedAt: 0 };
        return acc;
      }, {});
    }

    if (isRecord(parsed)) {
      const entries = Object.entries(parsed);
      return entries.reduce<ExplicitMeetDownloads>((acc, [meetId, value]) => {
        if (!value || typeof value !== 'object') return acc;
        const entry = value as { markedAt?: unknown; endDate?: unknown };
        acc[meetId] = {
          markedAt:
            typeof entry.markedAt === 'number' ? entry.markedAt : Date.now(),
          ...(typeof entry.endDate === 'string' ? { endDate: entry.endDate } : {}),
        };
        return acc;
      }, {});
    }

    return {};
  } catch (error) {
    console.error('Error reading explicit meet downloads:', error);
    return {};
  }
}

async function saveExplicitMeetDownloads(downloads: ExplicitMeetDownloads): Promise<void> {
  await AsyncStorage.setItem(
    EXPLICIT_MEET_DOWNLOADS_KEY,
    JSON.stringify(downloads),
  );
}

const explicitDownloadsWrites = createWriteChain();

export async function markMeetExplicitlyDownloaded(
  meetId: MeetName,
  downloaded: boolean,
  options?: { endDate?: string }
): Promise<void> {
  await explicitDownloadsWrites(async () => {
    const downloads = await getExplicitMeetDownloads();
    if (downloaded) {
      downloads[meetId] = {
        markedAt: Date.now(),
        ...(options?.endDate ? { endDate: options.endDate } : {}),
      };
    } else {
      delete downloads[meetId];
    }
    await saveExplicitMeetDownloads(downloads);
  });
}

export async function updateDownloadEndDates(endDates: ReadonlyMap<string, string>): Promise<void> {
  await explicitDownloadsWrites(async () => {
    const downloads = await getExplicitMeetDownloads();
    let changed = false;
    for (const [meetId, endDate] of endDates) {
      const entry = downloads[meetId];
      if (!entry || entry.endDate === endDate) continue;
      downloads[meetId] = { ...entry, endDate };
      changed = true;
    }
    if (changed) await saveExplicitMeetDownloads(downloads);
  });
}

export async function isMeetExplicitlyDownloaded(meetId: MeetName): Promise<boolean> {
  const downloads = await getExplicitMeetDownloads();
  return Boolean(downloads[meetId]);
}

export async function getExplicitlyDownloadedMeetIds(): Promise<Set<string>> {
  return new Set(Object.keys(await getExplicitMeetDownloads()));
}

export async function getExplicitMeetDownloadEntries(): Promise<
  { meet: MeetName; endDate?: string }[]
> {
  const downloads = await getExplicitMeetDownloads();
  return Object.entries(downloads).map(([meet, entry]) => ({
    meet: meet as MeetName,
    ...(entry.endDate ? { endDate: entry.endDate } : {}),
  }));
}
