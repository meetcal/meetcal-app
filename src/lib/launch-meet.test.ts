import type { Meet } from '@/data/types/meet';
import { chooseLaunchMeet, isMeetCompleted } from '@/lib/launch-meet';

function meet(name: string, dates: { start: string; end: string }, overrides: Partial<Meet> = {}): Meet {
  return {
    id: name,
    name,
    venue: { name: 'Venue', address: { street: '1 Main', city: 'Denver', state: 'CO', zip: '80202' } },
    time: {
      timeZone: 'America/Los_Angeles',
      timeZoneIdentifier: 'America/Los_Angeles',
      abbreviation: 'PDT',
      utcOffset: 7,
    },
    dates,
    status: 'upcoming',
    ...overrides,
  };
}

const JUNE = { start: '2026-06-20', end: '2026-06-22' };

describe('isMeetCompleted', () => {
  it('trusts a completed status whatever the dates say', () => {
    expect(isMeetCompleted(meet('A', JUNE, { status: 'completed' }), new Date('2026-06-01T00:00:00Z'))).toBe(true);
  });

  it('is not over until its last day has ended in the meet zone', () => {
    // 11:30pm on the last day in Los Angeles, already the next day in UTC.
    expect(isMeetCompleted(meet('A', JUNE), new Date('2026-06-23T06:30:00Z'))).toBe(false);
    // Just past midnight in Los Angeles.
    expect(isMeetCompleted(meet('A', JUNE), new Date('2026-06-23T07:01:00Z'))).toBe(true);
  });

  it('reads a meet with no known zone on the last calendar on Earth', () => {
    const unknown = meet('A', JUNE, { timeZoneUnknown: true });
    expect(isMeetCompleted(unknown, new Date('2026-06-23T11:00:00Z'))).toBe(false);
    expect(isMeetCompleted(unknown, new Date('2026-06-23T12:01:00Z'))).toBe(true);
  });

  it('falls back to the start date, and is never over without a date', () => {
    expect(isMeetCompleted(meet('A', { start: '2026-06-20', end: '' }), new Date('2026-06-22T12:00:00Z'))).toBe(true);
    expect(isMeetCompleted(meet('A', { start: '', end: '' }), new Date('2030-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('chooseLaunchMeet', () => {
  const now = new Date('2026-06-25T12:00:00Z');
  const ended = meet('Ended', JUNE);
  const ongoing = meet('Ongoing', { start: '2026-06-24', end: '2026-06-26' });
  const later = meet('Later', { start: '2026-07-10', end: '2026-07-12' });

  it('keeps the stored meet while it is not over', () => {
    expect(chooseLaunchMeet([ended, ongoing, later], 'Later', now)).toBe(later);
  });

  it('opens on the first meet that is not over once the stored meet has ended', () => {
    expect(chooseLaunchMeet([ended, ongoing, later], 'Ended', now)).toBe(ongoing);
  });

  it('skips ended meets at the top of the list with nothing stored', () => {
    expect(chooseLaunchMeet([ended, later], null, now)).toBe(later);
    expect(chooseLaunchMeet([ended, later], 'Not Listed', now)).toBe(later);
  });

  it('keeps the stored meet, then the first, when every meet is over', () => {
    const alsoEnded = meet('Also Ended', JUNE);
    expect(chooseLaunchMeet([ended, alsoEnded], 'Also Ended', now)).toBe(alsoEnded);
    expect(chooseLaunchMeet([ended, alsoEnded], null, now)).toBe(ended);
  });

  it('has nothing to open with no meets', () => {
    expect(chooseLaunchMeet([], 'Ended', now)).toBeNull();
  });
});
