import { Schedule, Session } from '@/types/schedule';
import { Platform } from '@/data/athletes';

export const schedule: Schedule = [
    {
      "date": "February 27",
      "fullDate": "2025-02-27",
      "sessions": [
        {
          "id": "1",
          "number": 1,
          "startTime": "8:00 AM",
          "weighInTime": "6:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "UNI M 73"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 49"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 55"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 61"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 55"
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
              "weightClass": "VWS1 W 55"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 73"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 44"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 61"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 59"
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
              "weightClass": "VWS1 W 30"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 73"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 55"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 67"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 73"
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
              "weightClass": "VWS1 M 67"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 73"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 45"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 49"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 55"
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
              "weightClass": "VWS1 W 59"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 55"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 61"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 81"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 73"
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
              "weightClass": "VWS1 W 59"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 49"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 55"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 59"
            },
            {
              "platform": "Stripes",
              "weightClass": "VWS1 M 81"
            }
          ]
        },
        {
          "id": "7",
          "number": 7,
          "startTime": "8:00 PM",
          "weighInTime": "6:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 59"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 67"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 73"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 81"
            },
            {
              "platform": "Stripes",
              "weightClass": "VWS1 M 81"
            }
          ]
        }
      ]
    },
    {
      "date": "February 28",
      "fullDate": "2025-02-28",
      "sessions": [
        {
          "id": "8",
          "number": 8,
          "startTime": "8:00 AM",
          "weighInTime": "6:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 64"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 81"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 71"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 89"
            }
          ]
        },
        {
          "id": "9",
          "number": 9,
          "startTime": "10:00 AM",
          "weighInTime": "8:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 64"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 81"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 64"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 89"
            }
          ]
        },
        {
          "id": "10",
          "number": 10,
          "startTime": "12:00 PM",
          "weighInTime": "10:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 64"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 59"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 64"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 81"
            }
          ]
        },
         {
          "id": "11",
          "number": 11,
          "startTime": "12:30 PM",
          "weighInTime": "10:30 AM",
          "platforms": [
            {
              "platform": "Rogue",
              "weightClass": "VWS1 Rogue W"
            }
          ]
        },
        {
          "id": "12",
          "number": 12,
          "startTime": "2:00 PM",
          "weighInTime": "12:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 64"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 59"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 71"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 81"
            }
          ]
        },
         {
          "id": "13",
          "number": 13,
          "startTime": "3:00 PM",
          "weighInTime": "1:00 PM",
          "platforms": [
            {
              "platform": "Rogue",
              "weightClass": "VWS1 Rogue M"
            }
          ]
        },
        {
          "id": "14",
          "number": 14,
          "startTime": "4:00 PM",
          "weighInTime": "2:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 64"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 81"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 71"
            },
            {
              "platform": "Stripes",
              "weightClass": "VWS1 W 71"
            }
          ]
        },
        {
          "id": "15",
          "number": 15,
          "startTime": "6:00 PM",
          "weighInTime": "4:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 64"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 81"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 71"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 89"
            }
          ]
        },
        {
          "id": "16",
          "number": 16,
          "startTime": "8:00 PM",
          "weighInTime": "6:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 64"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 81"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 71"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 89"
            }
          ]
        }
      ]
    },
    {
      "date": "March 1",
      "fullDate": "2025-03-01",
      "sessions": [
        {
          "id": "17",
          "number": 17,
          "startTime": "8:00 AM",
          "weighInTime": "6:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 71"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 96"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 76"
            }
          ]
        },
        {
          "id": "18",
          "number": 18,
          "startTime": "10:00 AM",
          "weighInTime": "8:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 71"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 96"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 81"
            }
          ]
        },
        {
          "id": "19",
          "number": 19,
          "startTime": "12:00 PM",
          "weighInTime": "10:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 71"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 96"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 76"
            }
          ]
        },
        {
          "id": "20",
          "number": 20,
          "startTime": "2:00 PM",
          "weighInTime": "12:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 71"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 102"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 81"
            }
          ]
        },
        {
          "id": "21",
          "number": 21,
          "startTime": "4:00 PM",
          "weighInTime": "2:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 71"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 81"
            },
            {
              "platform": "Stripes",
              "weightClass": "VWS1 M 102"
            }
          ]
        },
        {
          "id": "22",
          "number": 22,
          "startTime": "6:00 PM",
          "weighInTime": "4:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 71"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 81"
            },
            {
              "platform": "Stripes",
              "weightClass": "VWS1 W 87"
            }
          ]
        }
      ]
    },
    {
      "date": "March 2",
      "fullDate": "2025-03-02",
      "sessions": [
        {
          "id": "23",
          "number": 23,
          "startTime": "8:00 AM",
          "weighInTime": "6:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 M 102"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 81"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 87"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 87+"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 109"
            }
          ]
        },
        {
          "id": "24",
          "number": 24,
          "startTime": "10:00 AM",
          "weighInTime": "8:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 M 102"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 81"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 109"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 87+"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 109+"
            }
          ]
        },
        {
          "id": "25",
          "number": 25,
          "startTime": "12:00 PM",
          "weighInTime": "10:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 M 102"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 81"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 81+"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 87+"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 87"
            }
          ]
        },
        {
          "id": "26",
          "number": 26,
          "startTime": "1:40 PM",
          "weighInTime": "11:40 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 M 109+"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 87"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 87+"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 109"
            }
          ]
        },
        {
          "id": "27",
          "number": 27,
          "startTime": "4:00 PM",
          "weighInTime": "2:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 M 109+"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 109"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 87+"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 87+"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 109+"
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