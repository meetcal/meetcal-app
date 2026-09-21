import Constants from "expo-constants";

export interface VersionAnnouncement {
  version: string;
  title: string;
  message: string;
  features?: string[];
}

export const VERSION_ANNOUNCEMENTS: Record<string, Omit<VersionAnnouncement, 'version'>> = {
  '6.2.0': {
    title: 'What\'s New',
    message: 'MeetCal is now built for iPhone Duo.',
    features: [
      'Full-screen layout on the iPhone Duo inner display',
      'Schedule keeps your place when you fold, unfold, or enter Split View',
      'Rebuilt on Expo SDK 58 for iOS 27'
    ],
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

export function getAnnouncementForVersion(version: string): Omit<VersionAnnouncement, 'version'> | null {
  return VERSION_ANNOUNCEMENTS[version] || null;
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
