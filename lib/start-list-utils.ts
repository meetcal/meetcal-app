import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';
import { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';

const WEIGHT_CLASS_NAN_SENTINEL = Infinity;

export function sortWeightClasses(a: string, b: string): number {
  const aNum = parseInt(a.replace(/[^\d]/g, ''), 10);
  const bNum = parseInt(b.replace(/[^\d]/g, ''), 10);
  const aSafe = Number.isNaN(aNum) ? WEIGHT_CLASS_NAN_SENTINEL : aNum;
  const bSafe = Number.isNaN(bNum) ? WEIGHT_CLASS_NAN_SENTINEL : bNum;
  if (aSafe !== bSafe) return aSafe - bSafe;
  const aHasPlus = a.includes('+');
  const bHasPlus = b.includes('+');
  if (aHasPlus && !bHasPlus) return 1;
  if (!aHasPlus && bHasPlus) return -1;
  return 0;
}

export function sortAthletes(a: LiftResult, b: LiftResult): number {
  return a.name.localeCompare(b.name);
}

export async function requestCalendarPermissions(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

export const STARRED_CLUBS_FILTER = 'Favorites';

export function getChevronIcon(direction: 'down' | 'right'): string {
  return Platform.select({
    ios: `chevron.${direction}`,
    android: direction === 'right' ? 'chevron-forward' : 'chevron-down'
  }) || `chevron.${direction}`;
}

export function getSaveIcon(): string {
  return Platform.select({
    ios: "square.and.arrow.down",
    android: "download"
  }) || "square.and.arrow.down";
}

export function getCloseIcon(): string {
  return Platform.select({
    ios: "xmark",
    android: "close"
  }) || "xmark";
}

export function formatSessionDisplayDate(
  displayDate?: string,
  fullDate?: string,
  timeZoneId?: string
): string {
  if (!displayDate && !fullDate) return '';
  const normalized = displayDate?.toLowerCase();
  if (normalized === 'today' || normalized === 'tomorrow') return displayDate || '';
  if (fullDate && timeZoneId) {
    const [datePart] = fullDate.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const safeUtcDate = Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)
      ? new Date(fullDate)
      : new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return safeUtcDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: timeZoneId
    });
  }
  const source = fullDate || displayDate || '';
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return displayDate || source;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

const TIME_PART_REGEX = /^\d{1,2}:\d{2}$/;
const PERIOD_REGEX = /\s*(AM|PM)\s*$/i;

export function calculateWeighInTime(startTime: string): string | null {
  const trimmed = startTime.trim();
  let timePart: string;
  let periodPart: string | undefined;
  const spaceSplit = trimmed.split(/\s+/);
  if (spaceSplit.length >= 2) {
    periodPart = spaceSplit.pop()?.toUpperCase();
    timePart = spaceSplit.join(' ').trim();
  } else {
    const periodMatch = trimmed.match(PERIOD_REGEX);
    periodPart = periodMatch ? periodMatch[1].toUpperCase() : undefined;
    timePart = periodMatch ? trimmed.slice(0, periodMatch.index).trim() : trimmed;
  }
  if (!periodPart || (periodPart !== 'AM' && periodPart !== 'PM')) return null;
  if (!TIME_PART_REGEX.test(timePart)) return null;
  const [hours, minutes] = timePart.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
  let hour24 = hours;
  if (periodPart === 'PM' && hours !== 12) hour24 += 12;
  if (periodPart === 'AM' && hours === 12) hour24 = 0;
  let weighInHour = hour24 - 2;
  if (weighInHour < 0) weighInHour += 24;
  let weighInPeriod = 'AM';
  if (weighInHour >= 12) {
    weighInPeriod = 'PM';
    if (weighInHour > 12) weighInHour -= 12;
  }
  if (weighInHour === 0) weighInHour = 12;
  return `${weighInHour}:${minutes.toString().padStart(2, '0')} ${weighInPeriod}`;
}

export function getAgeCategory(age: number): string {
  if (age <= 13) return 'U13';
  if (age >= 14 && age <= 15) return 'U15';
  if (age >= 16 && age <= 17) return 'U17';
  if (age >= 18 && age <= 20) return 'Junior';
  if (age >= 21 && age <= 34) return 'Senior';
  if (age >= 90) return 'Masters 90+';
  const mastersStart = Math.floor((age - 35) / 5) * 5 + 35;
  return `Masters ${mastersStart}`;
}

export function parseWeightClasses(weightClass: string): string[] {
  if (!weightClass) return [];
  const classes = weightClass.split(' / ');
  const weightClasses = new Set<string>();
  classes.forEach(classStr => {
    const trimmedClass = classStr.trim();
    const match = trimmedClass.match(/^(\d+)(\+)?(?:kg)?$/i);
    if (match && match[1]) {
      const number = match[1];
      const plus = match[2] ? '+' : '';
      weightClasses.add(`${number}${plus}kg`);
    }
  });
  return Array.from(weightClasses);
}

export function isMeetName(meet: string | null): meet is MeetName {
  return meet !== null;
}
