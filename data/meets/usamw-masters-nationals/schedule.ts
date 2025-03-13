import { Schedule } from '@/types/schedule';

export const schedule: Schedule = [
  {
    date: "March 26, 2025",
    fullDate: "2025-03-26",
    sessions: [
      {
        id: "1",
        number: 1,
        startTime: "9:30 AM",
        weighInTime: "7:30 AM",
        platforms: [
          {
            platform: "Red",
            weightClass: "W70 & W75 45-87+",
          },
          {
            platform: "White",
            weightClass: "M80-90 55-109+, M75 55-61",
          },
          {
            platform: "Blue",
            weightClass: "W65 45-71",
          },
        ],
      },
      {
        id: "2",
        number: 2,
        startTime: "11:15 AM",
        weighInTime: "9:15 AM",
        platforms: [
          {
            platform: "Red",
            weightClass: "M75 67-81",
            platformStartTime: "11:15 AM",
          },
          {
            platform: "White",
            weightClass: "W60 45-55, W65 76-87+",
            platformStartTime: "11:30 AM",
          },
          {
            platform: "Blue",
            weightClass: "M70 55-67, M75 89-109+",
            platformStartTime: "11:30 AM",
          },
        ],
      },
      {
        id: "3",
        number: 3,
        startTime: "1:30 PM",
        weighInTime: "11:30 AM",
        platforms: [
          {
            platform: "Red",
            weightClass: "W60 59-71",
            platformStartTime: "1:15 PM",
          },
          {
            platform: "White",
            weightClass: "M70 73-109+",
            platformStartTime: "1:15 PM",
          },
          {
            platform: "Blue",
            weightClass: "W60 76-87+",
            platformStartTime: "1:30 PM",
          },
        ],
      },
      {
        id: "4",
        number: 4,
        startTime: "2:45 PM",
        weighInTime: "12:45 PM",
        platforms: [
          {
            platform: "Red",
            weightClass: "M65 55-81",
          },
          {
            platform: "White",
            weightClass: "M65 89-109+",
          },
        ],
      },
      {
        id: "5",
        number: 5,
        startTime: "4:45 PM",
        weighInTime: "2:45 PM",
        platforms: [
          {
            platform: "Red",
            weightClass: "W60 Deadlift",
            platformStartTime: "3:00 PM",
          },
          {
            platform: "White",
            weightClass: "All Wednesday Men Deadlift",
            platformStartTime: "4:45 PM",
          },
          {
            platform: "Blue",
            weightClass: "W65-75 Deadlift",
            platformStartTime: "4:45 PM",
          },
        ],
      },
    ],
  },
  {
    date: "March 27, 2025",
    fullDate: "2025-03-27",
    sessions: [
      {
        id: "6",
        number: 6,
        startTime: "9:30 AM",
        weighInTime: "7:30 AM",
        platforms: [
          {
            platform: "Red",
            weightClass: "W55 45-71",
          },
          {
            platform: "White",
            weightClass: "W55 76-87",
          },
          {
            platform: "Blue",
            weightClass: "M60 55-96",
          },
        ],
      },
      {
        id: "7",
        number: 7,
        startTime: "11:30 AM",
        weighInTime: "9:30 AM",
        platforms: [
          {
            platform: "Red",
            weightClass: "M55 55-89, M60 102-109+",
          },
          {
            platform: "White",
            weightClass: "W50 45-59, W55 87+",
          },
          {
            platform: "Blue",
            weightClass: "M50 55-73, M55 96-109+",
          },
        ],
      },
      {
        id: "8",
        number: 8,
        startTime: "1:45 PM",
        weighInTime: "11:45 AM",
        platforms: [
          {
            platform: "Red",
            weightClass: "W50 76-81",
          },
          {
            platform: "White",
            weightClass: "W50 64-71",
          },
          {
            platform: "Blue",
            weightClass: "M50 81-89",
            platformStartTime: "1:30 PM",
          },
        ],
      },
      {
        id: "9",
        number: 9,
        startTime: "3:15 PM",
        weighInTime: "1:15 PM",
        platforms: [
          {
            platform: "Red",
            weightClass: "M50 96-109+",
          },
          {
            platform: "White",
            weightClass: "W50 87-87+",
            platformStartTime: "3:45 PM",
          },
        ],
      },
      {
        id: "10",
        number: 10,
        startTime: "5:15 PM",
        weighInTime: "3:15 PM",
        platforms: [
          {
            platform: "Red",
            weightClass: "All Thursday Men Deadlift",
          },
          {
            platform: "White",
            weightClass: "All Thursday Women Deadlift",
          },
        ],
      },
    ],
  },
  {
    date: "March 28, 2025",
    fullDate: "2025-03-28",
        sessions: [
          {
            id: "11",
            number: 11,
            startTime: "9:30 AM",
            weighInTime: "7:30 AM",
            platforms: [
              {
                platform: "Red",
                weightClass: "W45 45-59",
              },
              {
                platform: "White",
                weightClass: "W45 64 & 71 B",
              },
              {
                platform: "Blue",
                weightClass: "M45 55-81",
              },
            ],
          },
          {
            id: "12",
            number: 12,
            startTime: "11:30 AM",
            weighInTime: "9:30 AM",
            platforms: [
              {
                platform: "Red",
                weightClass: "W45 71 A & 76",
              },
              {
                platform: "White",
                weightClass: "M45 89-96",
              },
              {
                platform: "Blue",
                weightClass: "W45 81-87+",
                platformStartTime: "11:45 AM",
              },
            ],
          },
          {
            id: "13",
            number: 13,
            startTime: "1:30 PM",
            weighInTime: "11:30 AM",
            platforms: [
              {
                platform: "Blue",
                weightClass: "M45 102-109+",
              },
            ],
          },
          {
            id: "14",
            number: 14,
            startTime: "3:45 PM",
            weighInTime: "1:45 PM",
            platforms: [
              {
                platform: "Red",
                weightClass: "All Friday Men & Women Deadlift",
              },
            ],
          },
        ],
      },
      {
        date: "March 29, 2025",
        fullDate: "2025-03-29",
        sessions: [
          {
            id: "15",
            number: 15,
            startTime: "9:15 AM",
            weighInTime: "7:15 AM",
            platforms: [
              {
                platform: "Red",
                weightClass: "W40 45-55",
              },
              {
                platform: "White",
                weightClass: "M40 55-73 & 81 B",
              },
              {
                platform: "Blue",
                weightClass: "W40 59",
              },
            ],
          },
          {
            id: "16",
            number: 16,
            startTime: "11:00 AM",
            weighInTime: "9:00 AM",
            platforms: [
              {
                platform: "Red",
                weightClass: "M40 81 A & 89",
                platformStartTime: "10:45 AM",
              },
              {
                platform: "White",
                weightClass: "W40 64",
              },
              {
                platform: "Blue",
                weightClass: "W40 71",
              },
            ],
          },
          {
            id: "17",
            number: 17,
            startTime: "1:00 PM",
            weighInTime: "11:00 AM",
            platforms: [
              {
                platform: "Red",
                weightClass: "W40 76",
              },
              {
                platform: "White",
                weightClass: "M40 96-109+",
                platformStartTime: "12:50 PM",
              },
              {
                platform: "Blue",
                weightClass: "W35 45-55, W40 81-87",
                platformStartTime: "12:45 PM",
              },
            ],
          },
          {
            id: "18",
            number: 18,
            startTime: "3:00 PM",
            weighInTime: "1:00 PM",
            platforms: [
              {
                platform: "Red",
                weightClass: "M35 55-73",
              },
              {
                platform: "White",
                weightClass: "M35 81",
                platformStartTime: "3:20 PM",
              },
              {
                platform: "Blue",
                weightClass: "W35 59-64",
              },
            ],
          },
          {
            id: "19",
            number: 19,
            startTime: "5:30 PM",
            weighInTime: "3:30 PM",
            platforms: [
              {
                platform: "Red",
                weightClass: "All Saturday Men & Women Deadlift",
              },
            ],
          },
        ],
      },
      {
        date: "March 30, 2025",
        fullDate: "2025-03-30",
        sessions: [
          {
            id: "20",
            number: 20,
            startTime: "9:15 AM",
            weighInTime: "7:15 AM",
            platforms: [
              {
                platform: "Red",
                weightClass: "W35 71-76",
              },
              {
                platform: "White",
                weightClass: "W35 81-87+",
              },
              {
                platform: "Blue",
                weightClass: "M35 89 & 96 B",
              },
            ],
          },
          {
            id: "21",
            number: 21,
            startTime: "11:15 AM",
            weighInTime: "9:15 AM",
            platforms: [
              {
                platform: "Red",
                weightClass: "M35 96 A & 102-109+",
                platformStartTime: "11:45 AM",
              },
              {
                platform: "White",
                weightClass: "M30 55-109+",
              },
              {
                platform: "Blue",
                weightClass: "W30 45-87+",
              },
            ],
          },
          {
            id: "22",
            number: 22,
            startTime: "1:45 PM",
            weighInTime: "11:45 AM",
            platforms: [
              {
                platform: "White",
                weightClass: "All Sunday Men & Women Deadlift",
              },
            ],
          },
        ],
      },
];
