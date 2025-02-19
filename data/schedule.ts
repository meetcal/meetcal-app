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
              "weightClass": "UNI M 73 C"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 49 B"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 55 C"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 61 C"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 55 B"
            }
          ]
        },
        {
          "id": "2",
          "number": 2,
          "startTime": "10:00 AM", //some at 9:50
          "weighInTime": "8:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 55 C"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 73 D"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 44 B"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 61 B"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 59 B"
            }
          ]
        },
        {
          "id": "3",
          "number": 3,
          "startTime": "12:00 PM", //some at 11:30
          "weighInTime": "10:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 30 A"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 73 C"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 55 A"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 67 A"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 73 B"
            }
          ]
        },
        {
          "id": "4",
          "number": 4,
          "startTime": "2:00 PM", //some at 1:10
          "weighInTime": "12:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 M 67 B"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 73 B"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 45 A"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 49 A"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 55 A"
            }
          ]
        },
        {
          "id": "5",
          "number": 5,
          "startTime": "4:00 PM", //some at 3
          "weighInTime": "2:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 59 E"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 55 B"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 61 A"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 81 D"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 73 A"
            }
          ]
        },
        {
          "id": "6",
          "number": 6,
          "startTime": "6:00 PM", //some at 5:30
          "weighInTime": "4:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 59 D"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 49 A"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 55 A"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 59 A"
            },
            {
              "platform": "Stripes",
              "weightClass": "VWS1 M 81 G"
            }
          ]
        },
        {
          "id": "7",
          "number": 7,
          "startTime": "8:00 PM", //some at 7:30/750
          "weighInTime": "6:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 59 C"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 67 A"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 73 A"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 81 C"
            },
            {
              "platform": "Stripes",
              "weightClass": "VWS1 M 81 F"
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
              "weightClass": "VWS1 W 64 G"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89 G"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 81 E"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 71 C"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 89 D"
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
              "weightClass": "VWS1 W 64 F"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89 F"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 81 D"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 64 B"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 89 C"
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
              "weightClass": "VWS1 W 64 E"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89 E"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 59 B"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 64 A"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 81 B"
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
              "weightClass": "VWS1 W 64 D"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89 D"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 59 A"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 71 B"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 81 A"
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
              "weightClass": "VWS1 W 64 C"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89 C"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 81 C"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 71 A"
            },
            {
              "platform": "Stripes",
              "weightClass": "VWS1 W 71 I"
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
              "weightClass": "VWS1 W 64 B"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89 B"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 81 B"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 71 H"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 89 B"
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
              "weightClass": "VWS1 W 64 A"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 89 A"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 81 A"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 71 G"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 89 A"
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
              "weightClass": "VWS1 W 71 F"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76 F"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96 F"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 96 C"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 76 B"
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
              "weightClass": "VWS1 W 71 E"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76 E"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96 E"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 96 B"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 81 B"
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
              "weightClass": "VWS1 W 71 D"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76 D"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96 D"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 96 A"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 76 A"
            }
          ]
        },
        {
          "id": "20",
          "number": 20,
          "startTime": "2:00 PM", //some at 1:40
          "weighInTime": "12:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 W 71 C"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76 C"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96 C"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 102 A"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 81 A"
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
              "weightClass": "VWS1 W 71 B"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76 B"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96 B"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 81 E"
            },
            {
              "platform": "Stripes",
              "weightClass": "VWS1 M 102 D"
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
              "weightClass": "VWS1 W 71 A"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 76 A"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 96 A"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 81 D"
            },
            {
              "platform": "Stripes",
              "weightClass": "VWS1 W 87 D"
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
              "weightClass": "VWS1 M 102 C"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 81 C"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 87 C"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 87+ E"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 109 B"
            }
          ]
        },
        {
          "id": "24",
          "number": 24,
          "startTime": "10:00 AM", //some at 9:50
          "weighInTime": "8:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 M 102 B"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 81 B"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 M 109 B"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 87+ D"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 109+ B"
            }
          ]
        },
        {
          "id": "25",
          "number": 25,
          "startTime": "12:00 PM", //some at 11:45/1210
          "weighInTime": "10:00 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 M 102 A"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 81 A"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 81+ B"
            },
            {
              "platform": "Stars",
              "weightClass": "VWS1 W 87+ C"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI W 87 A"
            }
          ]
        },
        {
          "id": "26",
          "number": 26,
          "startTime": "1:40 PM", //some at 1:40/130
          "weighInTime": "11:40 AM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 M 109+ B"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 W 87+ A"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 87+ B"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI M 109 A"
            }
          ]
        },
        {
          "id": "27",
          "number": 27,
          "startTime": "4:00 PM",//some at 3:30 / 145???
          "weighInTime": "2:00 PM",
          "platforms": [
            {
              "platform": "Red",
              "weightClass": "VWS1 M 109+ A"
            },
            {
              "platform": "White",
              "weightClass": "VWS1 M 109 A"
            },
            {
              "platform": "Blue",
              "weightClass": "VWS1 W 87+ A"
            },
            {
              "platform": "Stars",
              "weightClass": "UNI W 87+ A"
            },
            {
              "platform": "Stripes",
              "weightClass": "UNI M 109+ A"
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