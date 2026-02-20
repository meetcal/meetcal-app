import { MeetName } from "@/data/types/meet";
import { Schedule } from "./schedule";

export interface SessionPlatformDetails {
  platform: string;
  platformStartTime?: string;
  weightClass?: string;
}

export interface Session {
  number: number;
  platforms: SessionPlatformDetails[];
}

export interface SessionPlatformDetails {
  platform: string;
  platformStartTime?: string;
  weightClass?: string;
}

export interface HeaderSectionProps {
  sessionNumber: string;
  platform: string;
  weightClass: string;
  startTime: string;
  meet: MeetName;
  currentSchedule: Schedule;
  sessionId: string;
  sessionDate: string;
  sessionWeightClass: string;
  platformStartTime: string;
  platformWeighInTime: string;
  athleteName?: string;
}

// Type for just the athlete data we need
export interface SessionAthlete {
  name: string;
  age: number;
  club: string;
  entryTotal: number;
  weightClass: string;
};