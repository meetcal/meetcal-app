// `types/schedule.ts` is the source of truth for the schedule domain types.
// This module used to carry a structurally identical `Session` / platform
// pair; it now re-exports them under the names its importers already use.
import { isSamePlatform } from '@/lib/athletes';
import type { Platform, Session } from '@/types/schedule';

export type PlatformSession = Platform;
export type { Session };

export function getPlatformStartTime(session: Session, platformName: string): string {
  const platform = session.platforms.find(p => isSamePlatform(p.platform, platformName));
  return platform?.platformStartTime || session.startTime;
}
