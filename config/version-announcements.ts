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
