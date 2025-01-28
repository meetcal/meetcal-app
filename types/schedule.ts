export type Platform = {
  platform: 'Red' | 'White' | 'Blue';
  weightClass: string;
};

export type Session = {
  id: string;
  number: number;
  startTime: string;
  weighInTime: string;
  platforms: Platform[];
};

export type DaySchedule = {
  date: string;      // Display date (e.g., "Today", "Tomorrow")
  fullDate: string;  // Actual date (e.g., "2024-03-03")
  sessions: Session[];
};

export type Schedule = DaySchedule[]; 