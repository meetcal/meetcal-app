import Constants from "expo-constants";

export interface VersionAnnouncement {
  version: string;
  title: string;
  message: string;
  features?: string[];
}

export const VERSION_ANNOUNCEMENTS: Record<string, Omit<VersionAnnouncement, 'version'>> = {
  '5.4.1': {
    title: 'What\'s New',
    message: 'We\'ve made some improvements to enhance your experience!',
    features: [
      'Fixed a few bugs'
    ],
  },
};

export function getAnnouncementForVersion(version: string): Omit<VersionAnnouncement, 'version'> | null {
  return VERSION_ANNOUNCEMENTS[version] || null;
}

export const VERSION_ANNOUNCEMENT_KEY = "@version_announcement_seen";
export const CURRENT_VERSION = Constants.expoConfig?.version || "5.4.1";