import { isRecord } from '@/lib/is-record';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName } from '@/data/types/meet';
import { clearMeetData } from '@/lib/database/meet-data-clears';
import { getExplicitlyDownloadedMeetIds } from '@/lib/database/meet-downloads-registry';
import { MEETS_LIST_CACHE_KEY } from './meets-list-cache';
import { createWriteChain } from '@/lib/data/write-chain';
import { clearPackageEtag } from './package-etags';
import { fullPrefetchRequests, isMeetBeingOpened } from './prefetch-requests';

const MAX_CACHED_MEETS = 3;

const MEET_CACHE_KEY = '@meet_cache_info';

interface MeetInfo {
  lastAccessed: number;
  size: number;
}

interface CacheInfo {
  totalSize: number;
  meets: { [key: string]: MeetInfo };
}

export async function clearCachedMeetsList(): Promise<void> {
  try {
    await cacheInfoWrites(() => AsyncStorage.removeMany([MEETS_LIST_CACHE_KEY, MEET_CACHE_KEY]));
  } catch (error) {
    console.error('Error clearing cached meets list:', error);
  }
}

async function getCacheInfo(): Promise<CacheInfo> {
  try {
    const info = await AsyncStorage.getItem(MEET_CACHE_KEY);
    if (info) {
      const parsed: unknown = JSON.parse(info);
      if (isRecord(parsed)) {
        const candidate = parsed;
        if (isRecord(candidate.meets)) {
          const meets: Record<string, MeetInfo> = {};
          let totalSize = 0;
          for (const [name, value] of Object.entries(candidate.meets)) {
            if (!isRecord(value)) continue;
            const entry = value;
            if (
              typeof entry.lastAccessed !== 'number' || !Number.isFinite(entry.lastAccessed) || entry.lastAccessed < 0 ||
              typeof entry.size !== 'number' || !Number.isFinite(entry.size) || entry.size < 0
            ) continue;
            Object.defineProperty(meets, name, {
              value: { lastAccessed: entry.lastAccessed, size: entry.size },
              enumerable: true, configurable: true, writable: true,
            });
            totalSize += entry.size;
          }
          return { totalSize, meets };
        }
      }
    }
    return {
      totalSize: 0,
      meets: {}
    };
  } catch (error) {
    console.error('Error getting cache info:', error);
    return {
      totalSize: 0,
      meets: {}
    };
  }
}

const cacheInfoWrites = createWriteChain();

async function updateCacheInfo(mutate: (info: CacheInfo) => void): Promise<void> {
  try {
    await cacheInfoWrites(async () => {
      const info = await getCacheInfo();
      mutate(info);
      await AsyncStorage.setItem(MEET_CACHE_KEY, JSON.stringify(info));
    });
  } catch (error) {
    console.error('Error saving cache info:', error);
  }
}

export async function touchMeetAccess(meet: MeetName) {
  await updateCacheInfo((info) => {
    info.meets[meet] = {
      lastAccessed: Date.now(),
      size: info.meets[meet]?.size ?? 0,
    };
  });
}

export async function cleanupOldMeetData() {
  const info = await getCacheInfo();
  const meets = Object.entries(info.meets) as [MeetName, MeetInfo][];

  meets.sort(([, a], [, b]) => b.lastAccessed - a.lastAccessed);

  const explicitlyDownloaded = await getExplicitlyDownloadedMeetIds();

  let implicitKept = 0;
  const evicted: { meet: MeetName; lastAccessed: number }[] = [];
  for (const [meet, snapshot] of meets) {
    if (explicitlyDownloaded.has(meet)) {
      continue;
    }
    if (fullPrefetchRequests.has(meet)) {
      continue;
    }
    implicitKept += 1;
    if (implicitKept <= MAX_CACHED_MEETS) {
      continue;
    }
    const latest = (await getCacheInfo()).meets[meet];
    if (latest && latest.lastAccessed !== snapshot.lastAccessed) {
      continue;
    }
    if (isMeetBeingOpened(meet)) {
      continue;
    }
    await clearPackageEtag(meet);
    if (isMeetBeingOpened(meet)) {
      continue;
    }
    await clearMeetData(meet);
    evicted.push({ meet, lastAccessed: snapshot.lastAccessed });
  }

  if (evicted.length === 0) return;
  await updateCacheInfo((info) => {
    for (const { meet, lastAccessed } of evicted) {
      const current = info.meets[meet];
      if (current && current.lastAccessed !== lastAccessed) continue;
      delete info.meets[meet];
    }
  });
}
