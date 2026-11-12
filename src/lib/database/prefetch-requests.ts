import { MeetName } from '@/data/types/meet';
import { registerInFlightPrefetchSettler, wasClearedSince, type ClearEpoch } from './offline-clears';

export const criticalPrefetchRequests = new Map<MeetName, Promise<void>>();

export type FullPrefetchRequest = { promise: Promise<void>; startedAt: ClearEpoch };

export const fullPrefetchRequests = new Map<MeetName, FullPrefetchRequest>();

export class PrefetchCancelledError extends Error {
  constructor(meet: MeetName) {
    super(`Offline prefetch cancelled by a clear (${meet})`);
    this.name = 'PrefetchCancelledError';
  }
}

export type CancelCheck = () => void;

export function cancelCheckFor(meet: MeetName, startedAt: ClearEpoch): CancelCheck {
  return () => {
    if (wasClearedSince(meet, startedAt)) throw new PrefetchCancelledError(meet);
  };
}

registerInFlightPrefetchSettler(async (meet) => {
  const requests =
    meet === null
      ? Array.from(fullPrefetchRequests.values())
      : [fullPrefetchRequests.get(meet as MeetName)];
  await Promise.all(requests.map((request) => request?.promise.catch(() => undefined)));
});

export function isMeetBeingOpened(meet: MeetName): boolean {
  return criticalPrefetchRequests.has(meet) || fullPrefetchRequests.has(meet);
}
