import { Schedule } from '../../types/schedule';

export const schedule: Schedule = [
  {
    "date": "March 26, 2025",
    "fullDate": "2025-03-26",
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
      }
    ]
  }
  // Additional days and sessions will be added here
];

// Export helper functions
export * from '../../types/schedule';
