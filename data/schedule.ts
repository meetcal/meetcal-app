import { Schedule } from '@/types/schedule';

export const schedule: Schedule = [
  {
    date: 'March 3',
    fullDate: '2025-03-03',
    sessions: [
      {
        id: '1',
        number: 1,
        startTime: '8:00 AM',
        weighInTime: '6:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '49kg A',
          },
          {
            platform: 'White',
            weightClass: '55kg B',
          },
          {
            platform: 'Blue',
            weightClass: '61kg C',
          },
        ],
      },
      {
        id: '2',
        number: 2,
        startTime: '10:00 AM',
        weighInTime: '8:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '67kg A',
          },
          {
            platform: 'White',
            weightClass: '73kg B',
          },
          {
            platform: 'Blue',
            weightClass: '81kg E',
          },
        ],
      },
    ],
  },
  {
    date: 'March 4',
    fullDate: '2025-03-04',
    sessions: [
      {
        id: '3',
        number: 3,
        startTime: '9:00 AM',
        weighInTime: '7:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '55kg A',
          },
          {
            platform: 'Blue',
            weightClass: '81kg E',
          },
        ],
      },
      // Add more sessions here...
    ],
  },
  // Add more days here...
];

// Helper functions for working with schedule data
export function getSessionById(id: string): Session | undefined {
  for (const day of schedule) {
    const session = day.sessions.find(s => s.id === id);
    if (session) return session;
  }
  return undefined;
}

export function getPlatformColors() {
  return {
    Red: '#FF6B6B',
    White: '#4A4A4A',
    Blue: '#4DABF7',
  } as const;
} 