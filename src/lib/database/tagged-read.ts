import type { TaggedAnswer } from '@/lib/api/revalidated-reads';
import type { ResourceCacheEntry, TaggedFresh } from '@/lib/data/mutable-resource';
import { isNetworkAvailable } from '@/lib/networkUtils';
import type { OfflineCacheEntry } from './offline-cache';

export function mapTagged<R, T>(answer: TaggedAnswer<R>, map: (value: R) => T): TaggedFresh<T> {
  if (answer.status === 'unchanged') return { status: 'unchanged' };
  return { status: 'fresh', data: map(answer.value), tag: answer.tag };
}

export async function untagged<T>(fresh: Promise<TaggedFresh<T>>, label: string): Promise<T> {
  const answer = await fresh;
  if (answer.status === 'unchanged') throw new Error(`${label} answered unchanged to a read that held no tag`);
  return answer.data;
}

export async function requireNetwork(): Promise<void> {
  if (!(await isNetworkAvailable())) throw new Error('Offline');
}

export function resourceEntry<T>(stored: OfflineCacheEntry<T> | null): ResourceCacheEntry<T> | null {
  if (!stored) return null;
  const entry = { data: stored.data, lastUpdatedAt: stored.lastSynced };
  return stored.tag ? { ...entry, tag: stored.tag } : entry;
}
