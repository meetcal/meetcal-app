import { MeetName } from '../types/meet';
import { LiftResult } from '../types/athletes';
import { liftingResults as usawAthletes } from './usaw-masters-nationals/athletes';
import { liftingResults as usamwAthletes } from './usamw-masters-nationals/athletes';

const athletesData: { [K in MeetName]: LiftResult[] } = {
  'USAW Master\'s Nationals': usawAthletes,
  'Florida WSO Champs': usamwAthletes,
};

export function getAthletes(meetName: MeetName): LiftResult[] {
  return athletesData[meetName];
}

export function getAthleteByName(meetName: MeetName, name: string): LiftResult | undefined {
  return getAthletes(meetName).find(athlete => athlete.name === name);
}

export function getAthletesBySession(meetName: MeetName, sessionNumber: number, platform?: string): LiftResult[] {
  return getAthletes(meetName).filter(athlete => {
    if (!athlete.session) return false;
    if (athlete.session.number !== sessionNumber) return false;
    if (platform && athlete.session.platform !== platform) return false;
    return true;
  });
}

export function getAthletesByAgeGroup(meetName: MeetName, ageGroup: string): LiftResult[] {
  return getAthletes(meetName).filter(athlete => {
    const age = athlete.age;
    if (ageGroup === '35-39') return age >= 35 && age <= 39;
    if (ageGroup === '40-44') return age >= 40 && age <= 44;
    if (ageGroup === '45-49') return age >= 45 && age <= 49;
    if (ageGroup === '50-54') return age >= 50 && age <= 54;
    if (ageGroup === '55-59') return age >= 55 && age <= 59;
    if (ageGroup === '60-64') return age >= 60 && age <= 64;
    if (ageGroup === '65-69') return age >= 65 && age <= 69;
    if (ageGroup === '70-74') return age >= 70 && age <= 74;
    if (ageGroup === '75-79') return age >= 75 && age <= 79;
    if (ageGroup === '80+') return age >= 80;
    return false;
  });
} 