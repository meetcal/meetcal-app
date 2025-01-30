import { Schedule } from '@/types/schedule';
import { Platform } from '@/data/athletes';

export const schedule: Schedule = [
  {
    date: 'February 27',
    fullDate: '2025-02-27',
    sessions: [
      {
        id: '1',
        number: 1,
        startTime: '8:00 AM',
        weighInTime: '6:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '55kg D',
          },
          {
            platform: 'White',
            weightClass: '48kg B',
          },
          {
            platform: 'Blue',
            weightClass: '32kg-55kg C',
          },
          {
            platform: 'Stars',
            weightClass: '55kg-67kg C',
          },
          {
            platform: 'Stripes',
            weightClass: '55kg B',
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
            weightClass: '55kg C',
          },
          {
            platform: 'White',
            weightClass: '73kg D',
          },
          {
            platform: 'Blue',
            weightClass: '32kg-55kg B',
          },
          {
            platform: 'Stars',
            weightClass: '55kg-67kg B',
          },
          {
            platform: 'Stripes',
            weightClass: '59kg B',
          },
        ],
      },
      {
        id: '3',
        number: 3,
        startTime: '12:00 PM',
        weighInTime: '10:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '40kg A',
          },
          {
            platform: 'White',
            weightClass: '73kg C',
          },
          {
            platform: 'Blue',
            weightClass: '32kg-55kg A',
          },
          {
            platform: 'Stars',
            weightClass: '55kg-67kg A',
          },
          {
            platform: 'Stripes',
            weightClass: '73kg B',
          },
        ],
      },
      {
        id: '4',
        number: 4,
        startTime: '2:00 PM',
        weighInTime: '12:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '67kg B',
          },
          {
            platform: 'White',
            weightClass: '73kg B',
          },
          {
            platform: 'Blue',
            weightClass: '45kg A',
          },
          {
            platform: 'Stars',
            weightClass: '45-49kg A',
          },
          {
            platform: 'Stripes',
            weightClass: '55kg A',
          },
        ],
      },
      {
        id: '5',
        number: 5,
        startTime: '4:00 PM',
        weighInTime: '2:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '59kg E',
          },
          {
            platform: 'White',
            weightClass: '55kg B',
          },
          {
            platform: 'Blue',
            weightClass: '61kg A',
          },
          {
            platform: 'Stars',
            weightClass: '81kg D',
          },
          {
            platform: 'Stripes',
            weightClass: '73kg A',
          },
        ],
      },
      {
        id: '6',
        number: 6,
        startTime: '6:00 PM',
        weighInTime: '4:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '59kg D',
          },
          {
            platform: 'White',
            weightClass: '49kg A',
          },
          {
            platform: 'Blue',
            weightClass: '55kg A',
          },
          {
            platform: 'Stars',
            weightClass: '59kg A',
          },
          {
            platform: 'Stripes',
            weightClass: '81kg G',
          },
        ],
      },
      {
        id: '7',
        number: 7,
        startTime: '8:00 PM',
        weighInTime: '6:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '59kg C',
          },
          {
            platform: 'White',
            weightClass: '67kg A',
          },
          {
            platform: 'Blue',
            weightClass: '73kg A',
          },
          {
            platform: 'Stars',
            weightClass: '81kg C',
          },
          {
            platform: 'Stripes',
            weightClass: '81kg F',
          },
        ],
      },
    ],
  },
  {
    date: 'February 28',
    fullDate: '2025-02-28',
    sessions: [
      {
        id: '8',
        number: 8,
        startTime: '8:00 AM',
        weighInTime: '6:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '64kg G',
          },
          {
            platform: 'White',
            weightClass: '89kg G',
          },
          {
            platform: 'Blue',
            weightClass: '81kg E',
          },
          {
            platform: 'Stars',
            weightClass: '71kg C',
          },
          {
            platform: 'Stripes',
            weightClass: '89kg D',
          },
        ],
      },
      {
        id: '9',
        number: 9,
        startTime: '10:00 AM',
        weighInTime: '8:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '64kg F',
          },
          {
            platform: 'White',
            weightClass: '89kg F',
          },
          {
            platform: 'Blue',
            weightClass: '81kg D',
          },
          {
            platform: 'Stars',
            weightClass: '64kg B',
          },
          {
            platform: 'Stripes',
            weightClass: '89kg C',
          },
        ],
      },
      {
        id: '10',
        number: 10,
        startTime: '12:00 PM',
        weighInTime: '10:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '64kg E',
          },
          {
            platform: 'White',
            weightClass: '89kg F',
          },
          {
            platform: 'Blue',
            weightClass: '81kg D',
          },
          {
            platform: 'Stars',
            weightClass: '64kg B',
          },
          {
            platform: 'Stripes',
            weightClass: '89kg C',
          },
        ],
      },
      {
        id: '11',
        number: 11,
        startTime: '12:30 PM',
        weighInTime: '10:30 AM',
        platforms: [
          {
            platform: 'Rogue',
            weightClass: 'Female',
          },
        ],
      },
      {
        id: '12',
        number: 12,
        startTime: '2:00 PM',
        weighInTime: '12:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '64kg D',
          },
          {
            platform: 'White',
            weightClass: '89kg D',
          },
          {
            platform: 'Blue',
            weightClass: '59kg A',
          },
          {
            platform: 'Stars',
            weightClass: '71kg B',
          },
          {
            platform: 'Stripes',
            weightClass: '81kg A',
          },
        ],
      },
      {
        id: '13',
        number: 13,
        startTime: '3:00 PM',
        weighInTime: '1:00 PM',
        platforms: [
          {
            platform: 'Rogue',
            weightClass: 'Male',
          },
        ],
      },
      {
        id: '14',
        number: 14,
        startTime: '4:00 PM',
        weighInTime: '2:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '64kg C',
          },
          {
            platform: 'White',
            weightClass: '89kg C',
          },
          {
            platform: 'Blue',
            weightClass: '81kg C',
          },
          {
            platform: 'Stars',
            weightClass: '71kg A',
          },
          {
            platform: 'Stripes',
            weightClass: '71kg & +64kg I',
          },
        ],
      },
      {
        id: '15',
        number: 15,
        startTime: '6:00 PM',
        weighInTime: '4:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '64kg B',
          },
          {
            platform: 'White',
            weightClass: '89kg B',
          },
          {
            platform: 'Blue',
            weightClass: '81kg B',
          },
          {
            platform: 'Stars',
            weightClass: '71kg & +64kg H',
          },
          {
            platform: 'Stripes',
            weightClass: '89kg B',
          },
        ],
      },
      {
        id: '16',
        number: 16,
        startTime: '8:00 PM',
        weighInTime: '6:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '64kg A',
          },
          {
            platform: 'White',
            weightClass: '89kg A',
          },
          {
            platform: 'Blue',
            weightClass: '81kg A',
          },
          {
            platform: 'Stars',
            weightClass: '71kg & +64kg G',
          },
          {
            platform: 'Stripes',
            weightClass: '89kg A',
          },
        ],
      },
    ],
  },
  {
    date: 'March 1',
    fullDate: '2025-03-01',
    sessions: [

      {
        id: '17',
        number: 17,
        startTime: '8:00 AM',
        weighInTime: '6:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '71kg & +64kg F',
          },
          {
            platform: 'White',
            weightClass: '76kg F',
          },
          {
            platform: 'Blue',
            weightClass: '96kg & +89kg F',
          },
          {
            platform: 'Stars',
            weightClass: '96kg C',
          },
          {
            platform: 'Stripes',
            weightClass: '76kg B',
          },
        ],
      },
      {
        id: '18',
        number: 18,
        startTime: '10:00 AM',
        weighInTime: '8:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '71kg & +64kg E',
          },
          {
            platform: 'White',
            weightClass: '76kg E',
          },
          {
            platform: 'Blue',
            weightClass: '96kg & +89kg E',
          },
          {
            platform: 'Stars',
            weightClass: '96kg B',
          },
          {
            platform: 'Stripes',
            weightClass: '81kg B',
          },
        ],
      },
      {
        id: '19',
        number: 19,
        startTime: '12:00 PM',
        weighInTime: '10:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '71kg & +64kg D',
          },
          {
            platform: 'White',
            weightClass: '76kg D',
          },
          {
            platform: 'Blue',
            weightClass: '96kg & +89kg D',
          },
          {
            platform: 'Stars',
            weightClass: '96kg A',
          },
          {
            platform: 'Stripes',
            weightClass: '76kg A',
          },
        ],
      },
      {
        id: '20',
        number: 20,
        startTime: '2:00 PM',
        weighInTime: '12:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '71kg & +64kg C',
          },
          {
            platform: 'White',
            weightClass: '76kg C',
          },
          {
            platform: 'Blue',
            weightClass: '96kg & +89kg C',
          },
          {
            platform: 'Stars',
            weightClass: '102kg A',
          },
          {
            platform: 'Stripes',
            weightClass: '81kg A',
          },
        ],
      },
      {
        id: '21',
        number: 21,
        startTime: '4:00 PM',
        weighInTime: '2:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '71kg & +64kg B',
          },
          {
            platform: 'White',
            weightClass: '76kg B',
          },
          {
            platform: 'Blue',
            weightClass: '96kg & +89kg B',
          },
          {
            platform: 'Stars',
            weightClass: '81kg & +76kg E',
          },
          {
            platform: 'Stripes',
            weightClass: '102kg D',
          },
        ],
      },
      {
        id: '22',
        number: 22,
        startTime: '6:00 PM',
        weighInTime: '4:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '71kg & +64kg A',
          },
          {
            platform: 'White',
            weightClass: '76kg A',
          },
          {
            platform: 'Blue',
            weightClass: '96kg & +89kg A',
          },
          {
            platform: 'Stars',
            weightClass: '81kg & +76kg D',
          },
          {
            platform: 'Stripes',
            weightClass: '87kg & +81kg D',
          },
        ],
      },
    ],
  },
  {
    date: 'March 2',
    fullDate: '2025-03-02',
    sessions: [
      {
        id: '23',
        number: 23,
        startTime: '8:00 AM',
        weighInTime: '6:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '102kg C',
          },
          {
            platform: 'White',
            weightClass: '81kg & +76kg C',
          },
          {
            platform: 'Blue',
            weightClass: '87kg & +81kg C',
          },
          {
            platform: 'Stars',
            weightClass: '+87kg E',
          },
          {
            platform: 'Stripes',
            weightClass: '109kg B',
          },
        ],
      },
      {
        id: '24',
        number: 24,
        startTime: '10:00 AM',
        weighInTime: '8:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '102kg B',
          },
          {
            platform: 'White',
            weightClass: '81kg & +76kg B',
          },
          {
            platform: 'Blue',
            weightClass: '109kg & +102kg B',
          },
          {
            platform: 'Stars',
            weightClass: '+87kg D',
          },
          {
            platform: 'Stripes',
            weightClass: '+109kg B',
          },
        ],
      },
      {
        id: '25',
        number: 25,
        startTime: '12:00 PM',
        weighInTime: '10:00 AM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '102kg A',
          },
          {
            platform: 'White',
            weightClass: '81kg & +76kg A',
          },
          {
            platform: 'Blue',
            weightClass: '87kg & +81kg A',
          },
          {
            platform: 'Stars',
            weightClass: '+87kg C',
          },
          {
            platform: 'Stripes',
            weightClass: '87kg A',
          },
        ],
      },
      {
        id: '26',
        number: 26,
        startTime: '2:00 PM',
        weighInTime: '12:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '+109kg B',
          },
          {
            platform: 'White',
            weightClass: '87kg & +81kg B',
          },
          {
            platform: 'Blue',
            weightClass: '+87kg B',
          },
          {
            platform: 'Stars',
            weightClass: '109kg A',
          },
        ],
      },
      {
        id: '27',
        number: 27,
        startTime: '4:00 PM',
        weighInTime: '2:00 PM',
        platforms: [
          {
            platform: 'Red',
            weightClass: '+109kg A',
          },
          {
            platform: 'White',
            weightClass: '109kg & +102kg A',
          },
          {
            platform: 'Blue',
            weightClass: '+87kg A',
          },
          {
            platform: 'Stars',
            weightClass: '+87kg A',
          },
          {
            platform: 'Stripes',
            weightClass: '+109kg A',
          },
        ],
      },
    ],
  }
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
    Stars: '#B8860B',  // Changed to a richer gold color (darkgoldenrod)
    Stripes: '#9C27B0',  // Purple
    Rogue: '#4CAF50',  // Green
  } as const;
}

export interface PlatformSession {
  platform: Platform;
  weightClass: string;
} 