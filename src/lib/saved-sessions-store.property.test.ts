import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';

import {
  createSavedSessionsCache,
  parseStoredSessions,
  readStoredSessions,
  reloadStoredSessionsFallback,
  type SavedSession,
  type SavedSessionsStore,
} from '@/lib/saved-sessions-store';
import { corruptedArb, hostileStringArb, hostileValueArb } from '@/test-support/arbitraries';
import { faultPlanArb, installStorageChaos, storageFaultArb } from '@/test-support/chaos';
import { getSavedSessionsKey } from '@/utils/session';

/**
 * The read path of the saved-sessions list (`saved-sessions-store.ts`). The
 * list is what the Saved tab, reminders and widgets render, so whatever is on
 * disk, a read yields only sessions with every field the type promises, or
 * nothing. Writes are out of scope here.
 */

const nonBlank = fc.string({ minLength: 1, maxLength: 16 }).filter((value) => value.trim().length > 0);

const sessionArb: fc.Arbitrary<SavedSession> = fc
  .record(
    {
      id: nonBlank,
      meet: nonBlank,
      sessionNumber: fc.integer({ min: 1, max: 400 }),
      platform: nonBlank,
      weightClass: fc.string({ maxLength: 8 }),
      startTime: fc.string({ maxLength: 8 }),
      weighInTime: fc.string({ maxLength: 8 }),
      date: fc.string({ maxLength: 10 }),
      notes: fc.string({ maxLength: 20 }),
      athleteNames: fc.array(fc.string({ maxLength: 12 }), { maxLength: 3 }),
      athleteName: fc.string({ maxLength: 12 }),
    },
    { requiredKeys: ['id', 'meet', 'sessionNumber', 'platform', 'weightClass', 'startTime', 'weighInTime', 'date'] },
  )
  .map((session) => session as SavedSession);

const VALID_LIST: SavedSession[] = [
  {
    id: 'Nationals-45-Red',
    meet: 'Nationals',
    sessionNumber: 45,
    platform: 'Red',
    weightClass: '89',
    startTime: '8:00 AM',
    weighInTime: '6:00 AM',
    date: '2026-06-20',
    notes: 'warm up early',
    athleteNames: ['Ana Lopez'],
  },
  {
    id: 'Nationals-2-Blue',
    meet: 'Nationals',
    sessionNumber: 2,
    platform: 'Blue',
    weightClass: '',
    startTime: '',
    weighInTime: '',
    date: '',
  },
];

const storedBytesArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  hostileStringArb,
  fc.jsonValue({ maxDepth: 3 }).map((value) => JSON.stringify(value)),
  corruptedArb(VALID_LIST).map((value) => JSON.stringify(value) ?? ''),
  fc.array(fc.oneof(sessionArb, hostileValueArb), { maxLength: 4 }).map((rows) => JSON.stringify(rows)),
);

/** Every field the `SavedSession` type promises, as screens dereference them. */
function assertWellFormed(session: SavedSession): void {
  expect(typeof session.id).toBe('string');
  expect(session.id.trim()).not.toBe('');
  expect(typeof session.meet).toBe('string');
  expect(session.meet.trim()).not.toBe('');
  expect(Number.isInteger(session.sessionNumber)).toBe(true);
  expect(session.sessionNumber).toBeGreaterThanOrEqual(1);
  expect(typeof session.platform).toBe('string');
  expect(session.platform.trim()).not.toBe('');
  for (const field of ['weightClass', 'startTime', 'weighInTime', 'date'] as const) {
    expect(typeof session[field]).toBe('string');
  }
  if ('notes' in session) expect(typeof session.notes).toBe('string');
  if ('athleteName' in session) expect(typeof session.athleteName).toBe('string');
  if ('athleteNames' in session) {
    expect(Array.isArray(session.athleteNames)).toBe(true);
    for (const name of session.athleteNames ?? []) expect(typeof name).toBe('string');
  }
}

function makeStore(active: string) {
  const published: SavedSession[][] = [];
  const store: SavedSessionsStore = {
    cache: createSavedSessionsCache(),
    isActive: (userId) => userId === active,
    publish: (sessions) => published.push(sessions),
  };
  return { store, published };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('parseStoredSessions', () => {
  it('turns any stored bytes into well-formed sessions or none, never a throw', () => {
    fc.assert(
      fc.property(storedBytesArb, (raw) => {
        const sessions = parseStoredSessions(raw);
        expect(Array.isArray(sessions)).toBe(true);
        sessions.forEach(assertWellFormed);
      }),
    );
  });

  it('is a fixed point: re-reading what it returned changes nothing', () => {
    fc.assert(
      fc.property(storedBytesArb, (raw) => {
        const once = parseStoredSessions(raw);
        expect(parseStoredSessions(JSON.stringify(once))).toEqual(once);
      }),
    );
  });

  it('reads back a stored list of valid sessions unchanged', () => {
    fc.assert(
      // Unique ids: a repeated id is a legacy duplicate the read drops.
      fc.property(fc.uniqueArray(sessionArb, { selector: (session) => session.id, maxLength: 6 }), (sessions) => {
        expect(parseStoredSessions(JSON.stringify(sessions))).toEqual(sessions);
      }),
    );
  });
});

describe('reading the stored list under storage chaos', () => {
  const USER = 'user_a';
  const OTHER = 'user_b';

  it('a read returns well-formed sessions of the user asked for, or fails for the caller to fall back', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Unique ids, as the app stores them: a read drops a repeated id.
        fc.uniqueArray(sessionArb, { selector: (session) => session.id, minLength: 1, maxLength: 3 }),
        fc.uniqueArray(sessionArb, { selector: (session) => session.id, minLength: 1, maxLength: 3 }),
        faultPlanArb(storageFaultArb, 4),
        fc.boolean(),
        async (mine, theirs, plan, force) => {
          await AsyncStorage.clear();
          await AsyncStorage.setItem(getSavedSessionsKey(USER), JSON.stringify(mine));
          await AsyncStorage.setItem(getSavedSessionsKey(OTHER), JSON.stringify(theirs));
          const { store } = makeStore(USER);

          const chaos = installStorageChaos(plan);
          let read: SavedSession[] | 'failed';
          try {
            // The other user's list passes through the same cache first, as
            // on an account switch.
            await readStoredSessions(store, OTHER, force).catch(() => []);
            read = await readStoredSessions(store, USER, force).catch(() => 'failed' as const);
          } finally {
            chaos.restore();
          }

          if (read === 'failed') {
            // Only a storage rejection may surface; the hook then falls back.
            expect(plan.some((fault) => fault.kind === 'reject' || fault.kind === 'quota')).toBe(true);
            return;
          }
          read.forEach(assertWellFormed);
          const corrupted = plan.some((fault) => fault.kind === 'corrupt-read');
          if (!corrupted) expect(read).toEqual(mine);
          if (JSON.stringify(theirs) !== JSON.stringify(mine) && !corrupted) {
            expect(read).not.toEqual(theirs);
          }
          // Never the other user's list from the cache.
          if (store.cache.owner !== null) expect(store.cache.owner).toBe(USER);
        },
      ),
    );
  });

  it('the fallback reload never throws and publishes well-formed sessions or an empty list', async () => {
    await fc.assert(
      fc.asyncProperty(storedBytesArb, faultPlanArb(storageFaultArb, 2), async (raw, plan) => {
        await AsyncStorage.clear();
        if (raw !== null) await AsyncStorage.setItem(getSavedSessionsKey(USER), raw);
        const { store, published } = makeStore(USER);
        const chaos = installStorageChaos(plan);
        try {
          await reloadStoredSessionsFallback(store, USER);
        } finally {
          chaos.restore();
        }
        expect(published).toHaveLength(1);
        published[0].forEach(assertWellFormed);
      }),
    );
  });
});
