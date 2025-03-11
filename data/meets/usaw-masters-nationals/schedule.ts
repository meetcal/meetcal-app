import { Schedule, Session } from '@/types/schedule';
import { Platform } from '@/data/athletes';

export const schedule: Schedule = [
  {
    "date": "April 3, 2025",
    "fullDate": "2025-04-03",
    "sessions": [
      {
        "id": "1",
        "number": 1,
        "startTime": "8:00 AM",
        "weighInTime": "6:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W65-W80, All"
          },
          {
            "platform": "Blue",
            "weightClass": "M70-M80, All"
          }
        ]
      },
      {
        "id": "2",
        "number": 2,
        "startTime": "10:00 AM",
        "weighInTime": "8:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W60, All"
          },
          {
            "platform": "Blue",
            "weightClass": "M65, All"
          }
        ]
      },
      {
        "id": "3",
        "number": 3,
        "startTime": "12:00 PM",
        "weighInTime": "10:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W55, 45kg - 64kg"
          },
          {
            "platform": "Blue",
            "weightClass": "M60, All"
          }
        ]
      },
      {
        "id": "4",
        "number": 4,
        "startTime": "2:00 PM",
        "weighInTime": "12:00 PM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W55, 71kg - 87+kg"
          },
          {
            "platform": "Blue",
            "weightClass": "M55, All"
          }
        ]
      },
      {
        "id": "5",
        "number": 5,
        "startTime": "4:00 PM",
        "weighInTime": "2:00 PM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W50, 45kg - 59kg"
          },
          {
            "platform": "Blue",
            "weightClass": "W50, 64kg - 71kg"
          }
        ]
      },
      {
        "id": "6",
        "number": 6,
        "startTime": "6:00 PM",
        "weighInTime": "4:00 PM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "M50, 55kg-89kg"
          },
          {
            "platform": "Blue",
            "weightClass": "W50, 76kg - 87+kg"
          }
        ]
      }
    ]
  },
  {
    "date": "April 4, 2025",
    "fullDate": "2025-04-04",
    "sessions": [
      {
        "id": "7",
        "number": 7,
        "startTime": "8:00 AM",
        "weighInTime": "6:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W45, 45kg - 55kg"
          },
          {
            "platform": "White",
            "weightClass": "W45, 59kg"
          },
          {
            "platform": "Blue",
            "weightClass": "M50, 96kg-109+kg"
          }
        ]
      },
      {
        "id": "8",
        "number": 8,
        "startTime": "10:00 AM",
        "weighInTime": "8:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W45, 64kg"
          },
          {
            "platform": "White",
            "weightClass": "W45, 71kg"
          },
          {
            "platform": "Blue",
            "weightClass": "M45, 55kg-81kg"
          }
        ]
      },
      {
        "id": "9",
        "number": 9,
        "startTime": "12:00 PM",
        "weighInTime": "10:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W45, 76kg"
          },
          {
            "platform": "White",
            "weightClass": "W45, 81-87+kg"
          },
          {
            "platform": "Blue",
            "weightClass": "M45, 89kg"
          }
        ]
      },
      {
        "id": "10",
        "number": 10,
        "startTime": "2:00 PM",
        "weighInTime": "12:00 PM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W40, 64kg C"
          },
          {
            "platform": "White",
            "weightClass": "W40, 45kg-55kg"
          },
          {
            "platform": "Blue",
            "weightClass": "M45, 96-109+kg"
          }
        ]
      },
      {
        "id": "11",
        "number": 11,
        "startTime": "4:00 PM",
        "weighInTime": "2:00 PM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W40, 64kg B"
          },
          {
            "platform": "White",
            "weightClass": "W40, 59kg"
          },
          {
             "platform": "Blue",
             "weightClass": "M40, 55kg-81kg"
          }
        ]
      },
      {
        "id": "12",
        "number": 12,
        "startTime": "6:00 PM",
        "weighInTime": "4:00 PM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W40, 64kg A"
          },
          {
            "platform": "White",
            "weightClass": "M40, 89kg-96kg"
          }
        ]
      }
    ]
  },
  {
    "date": "April 5, 2025",
    "fullDate": "2025-04-05",
    "sessions": [
      {
        "id": "13",
        "number": 13,
        "startTime": "8:00 AM",
        "weighInTime": "6:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W40, 71kg B"
          },
          {
            "platform": "Blue",
            "weightClass": "M40, 102kg-109+kg B"
          }
        ]
      },
      {
        "id": "14",
        "number": 14,
        "startTime": "10:00 AM",
        "weighInTime": "8:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W40, 76kg B"
          },
          {
            "platform": "Blue",
            "weightClass": "M40, 102kg-109+kg A"
          }
        ]
      },
      {
        "id": "15",
        "number": 15,
        "startTime": "12:00 PM",
        "weighInTime": "10:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "M35, 55kg-73kg"
          },
          {
            "platform": "Blue",
            "weightClass": "W40, 71kg A"
          }
        ]
      },
      {
        "id": "16",
        "number": 16,
        "startTime": "2:00 PM",
        "weighInTime": "12:00 PM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W40, 76kg A"
          },
          {
            "platform": "Blue",
            "weightClass": "W40, 81kg-87kg"
          }
        ]
      },
      {
        "id": "17",
        "number": 17,
        "startTime": "4:00 PM",
        "weighInTime": "2:00 PM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W40, 87+kg"
          },
          {
            "platform": "Blue",
            "weightClass": "M35, 81kg"
          }
        ]
      },
      {
        "id": "18",
        "number": 18,
        "startTime": "6:00 PM",
        "weighInTime": "4:00 PM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W35, 45kg-55kg"
          },
          {
            "platform": "Blue",
            "weightClass": "M35, 89kg"
          }
        ]
      }
    ]
  },
  {
    "date": "April 6, 2025",
    "fullDate": "2025-04-06",
    "sessions": [
      {
        "id": "19",
        "number": 19,
        "startTime": "8:00 AM",
        "weighInTime": "6:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W35, 59kg-64kg C"
          },
          {
            "platform": "White",
            "weightClass": "M35, 96kg-109+kg C"
          },
          {
            "platform": "Blue",
            "weightClass": "W35, 71kg B"
          }
        ]
      },
      {
        "id": "20",
        "number": 20,
        "startTime": "10:00 AM",
        "weighInTime": "8:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W35, 59kg-64kg B"
          },
          {
            "platform": "White",
            "weightClass": "M35, 96kg-109+kg B"
          },
          {
            "platform": "Blue",
            "weightClass": "W35, 76kg-81kg B"
          }
        ]
      },
      {
        "id": "21",
        "number": 21,
        "startTime": "12:00 PM",
        "weighInTime": "10:00 AM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W35, 59kg-64kg A"
          },
          {
            "platform": "White",
            "weightClass": "W35, 71kg A"
          },
          {
            "platform": "Blue",
            "weightClass": "W35, 76kg-81kg A"
          }
        ]
      },
      {
        "id": "22",
        "number": 22,
        "startTime": "2:00 PM",
        "weighInTime": "12:00 PM",
        "platforms": [
          {
            "platform": "Red",
            "weightClass": "W35, 87kg"
          },
          {
            "platform": "White",
            "weightClass": "W35, 87+kg"
          },
          {
            "platform": "Blue",
            "weightClass": "M35, 96kg-109+kg A"
          }
        ]
      }
    ]
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

// Helper to check if a session has multiple different start times
export function getSessionTimeRange(session: Session): { start: string; end: string } | null {
  // If no platform has a specific time, return null to indicate single time
  const hasCustomTimes = session.platforms.some(p => p.platformStartTime);
  if (!hasCustomTimes) {
    return null;
  }

  // Get all times including default and platform-specific
  const times = session.platforms.map(p => p.platformStartTime || session.startTime);
  
  // Convert to 24h format for comparison
  const convertTo24h = (timeStr: string) => {
    const [time, period] = timeStr.split(' ');
    const [hours, minutes] = time.split(':').map(Number);
    let hour = hours;
    
    if (period === 'PM' && hours !== 12) {
      hour += 12;
    } else if (period === 'AM' && hours === 12) {
      hour = 0;
    }
    
    return { hour, minutes };
  };

  // Sort times and get earliest/latest
  const sortedTimes = times.sort((a, b) => {
    const timeA = convertTo24h(a);
    const timeB = convertTo24h(b);
    if (timeA.hour === timeB.hour) {
      return timeA.minutes - timeB.minutes;
    }
    return timeA.hour - timeB.hour;
  });

  return {
    start: sortedTimes[0],
    end: sortedTimes[sortedTimes.length - 1]
  };
}

// Helper to get the specific start time for a platform
export function getPlatformStartTime(session: Session, platformName: string): string {
  const platform = session.platforms.find(p => p.platform === platformName);
  return platform?.platformStartTime || session.startTime;
}

// Format time range for display
export function formatTimeRange(timeRange: { start: string; end: string }): string {
  if (timeRange.start === timeRange.end) {
    return timeRange.start;
  }
  return `${timeRange.start}-${timeRange.end}`;
} 