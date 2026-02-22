import Constants from "expo-constants";

export interface VersionAnnouncement {
  version: string;
  title: string;
  message: string;
  features?: string[];
}

export const VERSION_ANNOUNCEMENTS: Record<string, Omit<VersionAnnouncement, 'version'>> = {
  '5.3.0': {
    title: 'What\'s New',
    message: 'We\'ve made some improvements to enhance your experience!',
    features: [
      'New and improved weightlifting wrapped and clubs meet results! Check these out on the Info screen',
      'Faster data loading',
    ],
  },
};

export function getAnnouncementForVersion(version: string): Omit<VersionAnnouncement, 'version'> | null {
  return VERSION_ANNOUNCEMENTS[version] || null;
}

export const VERSION_ANNOUNCEMENT_KEY = "@version_announcement_seen";
export const CURRENT_VERSION = Constants.expoConfig?.version || "5.3.0";