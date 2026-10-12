import * as fc from 'fast-check';

import type { Meet } from '@/data/types/meet';
import { selectNextSession, STARTED_GRACE_MS, type NextSessionSelection } from '@/lib/next-session';
import type { SavedSession } from '@/lib/saved-sessions-store';
import { hostileStringArb } from '@/test-support/arbitraries';
import {
  addCalendarDays,
  clockStringArb,
  instantArb,
  meetLocalDate,
  meetTimeZoneArb,
} from '@/test-support/time-arbitraries';
import { convertZonedLocalToUTC } from '@/utils/timezone';

const SELECTED = 'Selected Meet';

function makeMeet(timeZone: string, status: Meet['status'], start: string, end: string): Meet {
  return {
    id: 'meet',
    name: SELECTED,
    venue: { name: 'Venue', address: { street: '1 St', city: 'City', state: 'ST', zip: '00000' } },
    // Typed as a US zone; the generator also sends the edge zones, which the
    // selection must handle the same way.
    time: {
      timeZone: 'Zone',
      timeZoneIdentifier: timeZone as Meet['time']['timeZoneIdentifier'],
      abbreviation: 'TZ',
      utcOffset: 0,
    },
    dates: { start, end },
    status,
  };
}

/** A saved session's start, the way stored rows spell it, or broken. */
const sessionStartArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })).chain(([h, m]) => clockStringArb(h, m)) },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: hostileStringArb },
);

type Scenario = { timeZone: string; now: Date; sessions: SavedSession[] };

/**
 * Saved sessions within a day either side of `now` at the meet, some for
 * another meet, some with a blank or broken date or start.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({ timeZone: meetTimeZoneArb, now: instantArb })
  .chain(({ timeZone, now }) => {
    const today = meetLocalDate(timeZone, now);
    const sessionArb = fc.record({
      meet: fc.oneof({ weight: 4, arbitrary: fc.constant(SELECTED) }, { weight: 1, arbitrary: fc.constant('Other Meet') }),
      date: fc.oneof(
        { weight: 6, arbitrary: fc.integer({ min: -1, max: 1 }).map((shift) => addCalendarDays(today, shift)) },
        { weight: 1, arbitrary: fc.constantFrom('', '2026-02-30', 'TBD') },
      ),
      startTime: sessionStartArb,
    });
    return fc.array(sessionArb, { maxLength: 8 }).map((rows) => ({
      timeZone,
      now,
      sessions: rows.map(
        (row, index): SavedSession => ({
          id: `s${index}`,
          sessionNumber: index + 1,
          platform: 'Red',
          weightClass: '89kg',
          weighInTime: '',
          ...row,
        }),
      ),
    }));
  });

/** When the session starts, or null when its date or start cannot be read. */
function startOf(session: SavedSession, timeZone: string): number | null {
  try {
    return convertZonedLocalToUTC(session.date, session.startTime, timeZone).getTime();
  } catch {
    return null;
  }
}

function select({ timeZone, now, sessions }: Scenario, at: Date = now): NextSessionSelection | null {
  return selectNextSession(sessions, SELECTED, makeMeet(timeZone, 'ongoing', '2000-01-01', '2000-01-01'), at);
}

function shuffledArb<T>(items: T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray(items, { minLength: items.length, maxLength: items.length });
}

describe('selectNextSession', () => {
  it('picks a saved session of the meet that has not passed the grace window, the soonest one', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { timeZone, now, sessions } = scenario;
        const eligible = sessions.filter((session) => {
          if (session.meet !== SELECTED) return false;
          const start = startOf(session, timeZone);
          return start !== null && start > now.getTime() - STARTED_GRACE_MS;
        });
        const selection = select(scenario);

        if (eligible.length === 0) {
          expect(selection).toBeNull();
          return;
        }
        expect(selection).not.toBeNull();
        expect(sessions).toContain(selection!.session);
        expect(selection!.session.meet).toBe(SELECTED);
        expect(selection!.startMs).toBe(startOf(selection!.session, timeZone));
        expect(selection!.startMs).toBeGreaterThan(now.getTime() - STARTED_GRACE_MS);
        for (const session of eligible) {
          expect(startOf(session, timeZone)).toBeGreaterThanOrEqual(selection!.startMs);
        }
      }),
    );
  });

  it('does not depend on the order sessions were saved in', () => {
    fc.assert(
      fc.property(
        scenarioArb.chain((scenario) => shuffledArb(scenario.sessions).map((shuffled) => ({ scenario, shuffled }))),
        ({ scenario, shuffled }) => {
          const original = select(scenario);
          const reordered = select({ ...scenario, sessions: shuffled });
          expect(reordered?.startMs).toBe(original?.startMs);
          // Two saved sessions starting at the same instant (two platforms)
          // are equally "next"; the first saved wins, so only the start is
          // order-free, and the pick is one of the tied sessions.
          if (reordered) {
            expect(startOf(reordered.session, scenario.timeZone)).toBe(original!.startMs);
          }
        },
      ),
    );
  });

  it('keeps the same session as now moves forward until its grace window ends', () => {
    fc.assert(
      fc.property(scenarioArb, fc.double({ min: 0, max: 1, noNaN: true }), (scenario, fraction) => {
        const selection = select(scenario);
        if (!selection) return;
        const nowMs = scenario.now.getTime();
        const graceEndMs = selection.startMs + STARTED_GRACE_MS;
        const later = new Date(nowMs + Math.floor((graceEndMs - 1 - nowMs) * fraction));
        expect(select(scenario, later)?.session).toBe(selection.session);
      }),
    );
  });

  it('shows nothing when the meet is neither ongoing nor on its dates at the meet', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 1, max: 30 }), (scenario, daysAgo) => {
        const today = meetLocalDate(scenario.timeZone, scenario.now);
        const ended = addCalendarDays(today, -daysAgo);
        const meet = makeMeet(scenario.timeZone, 'upcoming', addCalendarDays(ended, -2), ended);
        expect(selectNextSession(scenario.sessions, SELECTED, meet, scenario.now)).toBeNull();
      }),
    );
  });

  it('shows nothing a grace window after the last session started', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const starts = scenario.sessions
          .filter((session) => session.meet === SELECTED)
          .map((session) => startOf(session, scenario.timeZone))
          .filter((start): start is number => start !== null);
        if (starts.length === 0) return;
        const afterAll = new Date(Math.max(...starts) + STARTED_GRACE_MS);
        expect(select(scenario, afterAll)).toBeNull();
      }),
    );
  });
});
