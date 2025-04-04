import { MeetName } from '../types/meet';
import { Schedule, Session } from '../types/schedule';
import { schedule as usawSchedule } from './usaw-masters-nationals/schedule';
import { schedule as usamwSchedule } from './usamw-masters-nationals/schedule';

const schedules: { [K in MeetName]: Schedule } = {
  'USAW Master\'s Nationals': usawSchedule,
  'Florida WSO Champs': usamwSchedule,
};

export function getSchedule(meetName: MeetName): Schedule {
  return schedules[meetName];
}

export function getSessionById(meetName: MeetName, id: string): Session | undefined {
  const schedule = getSchedule(meetName);
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
    Stars: '#B8860B',
    Stripes: '#9C27B0',
    Rogue: '#4CAF50',
  } as const;
} 