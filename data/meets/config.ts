import { MeetConfig, MeetName } from '../types/meet';

export const meetConfigs: { [K in MeetName]: MeetConfig } = {
  'USAW Master\'s Nationals': {
    name: 'USAW Master\'s Nationals',
    venue: {
      name: 'Georgia International Convention Center',
      address: {
        street: '2000 Convention Center Concourse',
        city: 'College Park',
        state: 'GA',
        zip: '30337',
      },
    },
    time: {
      timeZone: 'Eastern Time',
      timeZoneIdentifier: 'America/New_York',
    },
    dates: {
      start: '2025-04-03',
      end: '2025-04-06',
    },
  },
  'USAMW Master\'s Nationals': {
    name: 'USAMW Master\'s Nationals',
    venue: {
      name: 'Boise Expo Center',
      address: {
        street: '5610 North Glenwood Street',
        city: 'Boise',
        state: 'ID',
        zip: '83714',
      },
    },
    time: {
      timeZone: 'Mountain Time',
      timeZoneIdentifier: 'America/Boise',
    },
    dates: {
      start: '2025-03-26',
      end: '2025-03-30',
    },
  },
};

export function getMeetConfig(meetName: MeetName): MeetConfig {
  return meetConfigs[meetName];
}

export function getDefaultMeet(): MeetName {
  return 'USAW Master\'s Nationals';
}

export function isValidMeet(meetName: string): meetName is MeetName {
  return meetName in meetConfigs;
} 