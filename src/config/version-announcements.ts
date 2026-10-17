import Constants from "expo-constants";
import { Platform } from "react-native";

export type AnnouncementPlatform = "ios" | "android";

export interface VersionAnnouncement {
  version: string;
  title: string;
  message: string;
  features?: string[];
  /**
   * Platforms the announcement is written for. Omitted means every platform.
   * Both platforms share one app version, so content about one of them
   * (iPhone Duo, iOS 27) must say so or Android users see it too.
   */
  platforms?: AnnouncementPlatform[];
}

export const VERSION_ANNOUNCEMENTS: Record<string, Omit<VersionAnnouncement, 'version'>> = {
  '6.2.1': {
    title: 'What\'s New',
    message: 'Bug fixes and improvements.',
  },
  '6.2.0': {
    title: 'What\'s New',
    message: 'MeetCal now supports iPhone Duo.',
    features: [
      'Support for iPhone Duo',
      'Bug fixes'
    ],
    platforms: ['ios'],
  },
  '6.1.0': {
    title: 'What\'s New',
    message: 'We\'ve made some improvements to enhance your experience!',
    features: [
      'PR badges on athlete meet results',
      'Start list best lifts enhancement',
      'Smoother animations and cleaner notifications throughout the app'
    ],
  },
};

export function getAnnouncementForVersion(
  version: string,
  platform: string = Platform.OS,
): Omit<VersionAnnouncement, 'version'> | null {
  const announcement = VERSION_ANNOUNCEMENTS[version];
  if (!announcement) return null;
  if (
    announcement.platforms &&
    !announcement.platforms.some((allowed) => allowed === platform)
  ) {
    return null;
  }
  return announcement;
}

export const VERSION_ANNOUNCEMENT_KEY = "@version_announcement_seen";
export const CURRENT_VERSION = Constants.expoConfig?.version || "6.1.0";

/**
 * The list of announcement versions the user has already dismissed.
 *
 * The stored blob is whatever was last written to AsyncStorage, so it is
 * `unknown` until proven otherwise. The callers used to `JSON.parse` it and go
 * straight to `.includes` / `.push`: a non-array blob made `.push` throw inside
 * the dismiss handler, the catch swallowed it, the version was never recorded,
 * and the modal re-appeared on every launch with no way for the user to get rid
 * of it. An unreadable list is treated as "nothing seen yet" and is overwritten
 * by the next dismiss.
 */
export function parseSeenVersions(stored: string | null | undefined): string[] {
  if (!stored) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((version): version is string => typeof version === "string");
}
