import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LiftResult, Platform } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import type { Schedule } from '@/types/schedule';

/**
 * Dev-only client-side mock data for the selected meet. When enabled for a
 * meet, fetchSchedule/fetchAthletesWithSession (lib/database/queries) return
 * generated sessions and athletes instead of hitting the API, so meets with
 * no published data can be used to exercise the schedule, start list,
 * session details, and countdown card. Never active outside __DEV__.
 */

const DEV_MOCK_MEET_KEY = '@dev_mock_meet';

let mockedMeet: string | null = null;
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    mockedMeet = await AsyncStorage.getItem(DEV_MOCK_MEET_KEY);
  } catch {
    mockedMeet = null;
  }
}

export async function isMockedMeet(meet: MeetName): Promise<boolean> {
  if (!__DEV__) return false;
  await hydrate();
  return mockedMeet === meet;
}

export async function getMockedMeet(): Promise<string | null> {
  if (!__DEV__) return null;
  await hydrate();
  return mockedMeet;
}

export async function enableMockMeetData(meet: MeetName): Promise<void> {
  if (!__DEV__) return;
  hydrated = true;
  mockedMeet = meet;
  await AsyncStorage.setItem(DEV_MOCK_MEET_KEY, meet);
}

export async function disableMockMeetData(): Promise<void> {
  if (!__DEV__) return;
  hydrated = true;
  mockedMeet = null;
  await AsyncStorage.removeItem(DEV_MOCK_MEET_KEY);
}

const SESSION_TIMES: { start: string; weighIn: string }[] = [
  { start: '9:00 AM', weighIn: '7:00 AM' },
  { start: '12:00 PM', weighIn: '10:00 AM' },
  { start: '3:00 PM', weighIn: '1:00 PM' },
];

const PLATFORMS: Platform[] = ['Red', 'Blue'];

const WOMEN_CLASSES = ['48kg', '53kg', '58kg', '63kg', '69kg', '77kg', '86kg', '86+kg'];
const MEN_CLASSES = ['60kg', '65kg', '71kg', '79kg', '88kg', '94kg', '110kg', '110+kg'];

const FIRST_NAMES = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Quinn', 'Avery',
  'Dakota', 'Reese', 'Skyler', 'Emerson', 'Rowan', 'Sage', 'Finley', 'Harper',
];
const LAST_NAMES = [
  'Stone', 'Rivera', 'Chen', 'Novak', 'Okafor', 'Silva', 'Kowalski', 'Haddad',
  'Bergman', 'Ito', 'Marsh', 'Delgado', 'Frey', 'Lund', 'Pratt', 'Vance',
];
const CLUBS = [
  'Iron Path Barbell', 'Northside Weightlifting', 'Anvil Athletics',
  'Summit Strength', 'Riverbend Barbell', 'Test Club WL',
];
const WSOS = ['Minnesota', 'Ohio', 'Texas-Oklahoma', 'Carolina', 'Pacific Northwest'];

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function displayDate(fullDate: string): string {
  return new Date(`${fullDate}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** Three days of sessions starting today, deterministic for a given day. */
export function getMockSchedule(_meet: MeetName): Schedule {
  const schedule: Schedule = [];
  let sessionNumber = 0;
  for (let dayIndex = 0; dayIndex < 3; dayIndex++) {
    const date = new Date();
    date.setDate(date.getDate() + dayIndex);
    const fullDate = toDateString(date);
    schedule.push({
      date: displayDate(fullDate),
      fullDate,
      sessions: SESSION_TIMES.map((times) => {
        sessionNumber += 1;
        return {
          id: String(sessionNumber),
          number: sessionNumber,
          startTime: times.start,
          weighInTime: times.weighIn,
          platforms: PLATFORMS.map((platform, platformIndex) => ({
            platform,
            weightClass:
              platform === 'Red'
                ? WOMEN_CLASSES[(sessionNumber + platformIndex) % WOMEN_CLASSES.length]
                : MEN_CLASSES[(sessionNumber + platformIndex) % MEN_CLASSES.length],
          })),
        };
      }),
    });
  }
  return schedule;
}

const ATHLETES_PER_PLATFORM = 8;

export function getMockAthletesWithSession(
  meet: MeetName,
  sessionNumber?: number,
  platform?: string,
): LiftResult[] {
  const schedule = getMockSchedule(meet);
  const athletes: LiftResult[] = [];

  schedule.forEach((day) => {
    day.sessions.forEach((session) => {
      session.platforms.forEach((sessionPlatform) => {
        const isWomen = sessionPlatform.platform === 'Red';
        for (let i = 0; i < ATHLETES_PER_PLATFORM; i++) {
          const seed = session.number * 31 + (isWomen ? 0 : 500) + i;
          const name = `${FIRST_NAMES[seed % FIRST_NAMES.length]} ${
            LAST_NAMES[(seed + i) % LAST_NAMES.length]
          }`;
          athletes.push({
            memberId: `mock-${session.number}-${sessionPlatform.platform}-${i}`,
            name,
            age: 18 + (seed % 22),
            club: CLUBS[seed % CLUBS.length],
            wso: WSOS[seed % WSOS.length],
            gender: isWomen ? 'F' : 'M',
            weightClass: sessionPlatform.weightClass,
            entryTotal: (isWomen ? 120 : 200) + (seed % 12) * 7,
            adaptive: false,
            session: {
              number: session.number,
              platform: sessionPlatform.platform,
              date: day.fullDate,
              startTime: session.startTime,
              weighInTime: session.weighInTime,
              displayDate: day.date,
            },
          });
        }
      });
    });
  });

  return athletes.filter(
    (athlete) =>
      (sessionNumber == null || athlete.session?.number === sessionNumber) &&
      (platform == null || athlete.session?.platform === platform),
  );
}
