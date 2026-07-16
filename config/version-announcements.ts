import Constants from "expo-constants";

export interface VersionAnnouncement {
  version: string;
  title: string;
  message: string;
  features?: string[];
}

export const VERSION_ANNOUNCEMENTS: Record<string, Omit<VersionAnnouncement, 'version'>> = {
  '6.1.0': {
    title: 'What\'s New',
    message: 'We\'ve made some improvements to enhance your experience!',
    features: [
      'Meet day countdown card showing your next session and weigh-in time',
      'PR badges on athlete meet results',
      'Start list now shows last results for athletes returning from time off',
      'New Liquid Glass design on menus and pop-ups',
      'Smoother animations and cleaner notifications throughout the app'
    ],
  },
  '6.0.0': {
    title: 'What\'s New',
    message: 'We\'ve made some improvements to enhance your experience!',
    features: [
      'Optimized app loading to show you data 25x faster',
      'Improved login experience',
      'New iOS widgets',
      'Added support for shortcuts and Siri AI'
    ],
  },
};

export function getAnnouncementForVersion(version: string): Omit<VersionAnnouncement, 'version'> | null {
  return VERSION_ANNOUNCEMENTS[version] || null;
}

export const VERSION_ANNOUNCEMENT_KEY = "@version_announcement_seen";
export const CURRENT_VERSION = Constants.expoConfig?.version || "6.0.0";
