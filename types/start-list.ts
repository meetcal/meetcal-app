import { LiftResult } from "@/data/types/athletes";
import type { Schedule as ScheduleType } from "@/types/schedule";
import { useRouter } from "expo-router";
import { Animated } from "react-native";

export type ShareBackgroundPresetId =
  | "white"
  | "transparent";

export interface ImagePreviewModalProps {
    visible: boolean;
    whiteImageUri: string | null;
    transparentImageUri: string | null;
    selectedIndex: number;
    onChangeIndex: (index: number) => void;
    onClose: () => void;
}

export interface ShareScheduleViewProps {
    filteredAthletes: LiftResult[];
    schedule: ScheduleType;
    selectedMeet: string;
    selectedGroup: string;
    backgroundPreset?: ShareBackgroundPresetId;
    getSessionDetails: (sessionNumber: number) => {
        date: string;
        startTime: string;
        weighInTime: string;
        displayDate: string;
        platforms: { platform: string; platformStartTime?: string }[];
    } | null;
}

export interface ActionModalProps {
    visible: boolean;
    onClose: () => void;
    athleteCount: number;
    isSubscribed: boolean | null;
    onSaveAll: () => void;
    onSaveToCalendar: () => void;
    onCreateShareableSchedule: () => void;
    onDownloadShareableSchedule: () => void;
} 

export interface SessionDetails {
    date: string;
    startTime: string;
    weighInTime: string;
    displayDate: string;
    platforms: { platform: string; platformStartTime?: string }[];
  }
  
export interface AthleteItemProps {
    athlete: LiftResult;
    router: ReturnType<typeof useRouter>;
    getSessionDetails: (sessionNumber: number) => SessionDetails | null;
    onExpand?: (index: number) => void;
    index?: number;
}

export interface StartListSkeletonProps {
    skeletonPulse: Animated.Value;
  }
