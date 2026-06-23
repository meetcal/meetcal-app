import { Platform } from './athletes';
import { calculateWeighInTime } from '@/utils/time';

export interface PlatformSession {
  platform: Platform;
  weightClass: string;
  platformStartTime?: string;  // Optional platform-specific start time
}

export interface Session {
  id: string;
  number: number;
  startTime: string;
  weighInTime: string;
  platforms: PlatformSession[];
}

// Re-export calculateWeighInTime from utils for backwards compatibility
export { calculateWeighInTime };

export function getPlatformStartTime(session: Session, platformName: string): string {
  const platform = session.platforms.find(p => p.platform === platformName);
  return platform?.platformStartTime || session.startTime;
}