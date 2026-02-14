import Constants from "expo-constants";

export interface VersionAnnouncement {
  version: string;
  title: string;
  message: string;
  features?: string[];
}

export const VERSION_ANNOUNCEMENTS: Record<string, Omit<VersionAnnouncement, 'version'>> = {
  '5.2.5': {
    title: 'What\'s New',
    message: 'We\'ve made some improvements to enhance your experience!',
    features: [
      'New offline data page to save for offline use',
      'Export your club\'s start list with either a white or transparent background',
      'Bug fixes and optimizations',
    ],
  },
};

export function getAnnouncementForVersion(version: string): Omit<VersionAnnouncement, 'version'> | null {
  return VERSION_ANNOUNCEMENTS[version] || null;
}

export const VERSION_ANNOUNCEMENT_KEY = "@version_announcement_seen";
export const CURRENT_VERSION = Constants.expoConfig?.version || "5.2.5";