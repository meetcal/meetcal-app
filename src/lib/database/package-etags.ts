import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MeetName } from '@/data/types/meet';
import { createWriteChain } from '@/lib/data/write-chain';

/**
 * `/meets/package` ETag per meet: the "this package was decomposed here"
 * marker a prefetch revalidates against.
 *
 * Its own module because both sides of a meet's lifecycle write it: the
 * prefetch (`meet-manager`) saves it, and every clear of the meet's data
 * (`offline-store`'s `clearMeetData`, the history clear) must drop it, or the
 * next download trusts a `304` for data that is gone. One write chain covers
 * all of them.
 */
export const PACKAGE_ETAG_STORAGE_KEY = '@meet_package_etag_v1';

/** Every meet's stored validator, by meet. */
export async function readPackageEtags(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(PACKAGE_ETAG_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Keep only usable tags, so a corrupt entry is dropped on the next
      // write instead of being carried forward indefinitely.
      const etags: Record<string, string> = {};
      for (const [meet, etag] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof etag === 'string' && etag.length > 0) etags[meet] = etag;
      }
      return etags;
    }
  } catch (error) {
    console.error('Error reading package etags:', error);
  }
  return {};
}

async function writePackageEtags(etags: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(PACKAGE_ETAG_STORAGE_KEY, JSON.stringify(etags));
  } catch (error) {
    console.error('Error saving package etags:', error);
  }
}

export async function getStoredPackageEtag(meet: MeetName): Promise<string | null> {
  const etags = await readPackageEtags();
  const etag = etags[meet];
  return typeof etag === 'string' && etag.length > 0 ? etag : null;
}

/**
 * The ETag blob is read-modify-written by concurrent prefetches of different
 * meets, by eviction and by every clear; serialized like the other per-meet
 * blobs.
 */
const packageEtagWrites = createWriteChain();

export async function savePackageEtag(meet: MeetName, etag: string | null): Promise<void> {
  await packageEtagWrites(async () => {
    const etags = await readPackageEtags();
    if (etag) {
      etags[meet] = etag;
    } else {
      delete etags[meet];
    }
    await writePackageEtags(etags);
  });
}

export async function clearPackageEtag(meet: MeetName): Promise<void> {
  await savePackageEtag(meet, null);
}

/** Drops every meet's validator (the athlete history they vouched for is gone). */
export async function clearAllPackageEtags(): Promise<void> {
  await packageEtagWrites(() => AsyncStorage.removeItem(PACKAGE_ETAG_STORAGE_KEY));
}
