export type Platform = {
  platform: 'Red' | 'White' | 'Blue' | 'Stars' | 'Stripes' | 'Rogue';
  weightClass: string;
  platformStartTime?: string; // Optional field for platform-specific start time
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

export interface DayViewProps {
  day: DaySchedule;
  timeZone: string;
  meet: string;
  onRefreshComplete?: () => Promise<void>;
  refreshing: boolean;
}

export interface Meet {
  id: string;
  name: string;
  dates?: {
    start: string;
    end?: string;
  };
}

export interface MeetSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  meets: Meet[];
  selectedMeet: string | null;
  onSelectMeet: (meetName: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

export interface OnboardingViewProps {
  visible: boolean;
  onComplete: () => void;
}

export interface PageIndicatorProps {
  count: number;
  currentPage: number;
  onPageChange?: (page: number) => void;
}

export interface ScheduleSkeletonProps {
  label?: string;
}

export interface SessionViewProps {
  session: Session;
  timeZone: string;
  meet: string;
}

export interface VersionAnnouncementProps {
  announcement?: {
    title: string;
    message: string;
    features?: string[];
  };
}