import type { Meet } from '@/data/types/meet';
import {
  chooseLaunchMeet,
  decideAfterActiveMeetLookup,
  decideAfterFreshList,
  decideAfterStoredMeetLookup,
  decideFromCachedList,
  isMeetCompleted,
} from '@/lib/launch-meet';

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

describe('the launch decisions', () => {
  const now = new Date('2026-06-25T12:00:00Z');
  const ended = meet('Ended', JUNE);
  const ongoing = meet('Ongoing', { start: '2026-06-24', end: '2026-06-26' });
  const later = meet('Later', { start: '2026-07-10', end: '2026-07-12' });
  const archived = meet('Archived', { start: '2026-08-01', end: '2026-08-02' });
  const freshListInput = {
    freshMeets: [ongoing, later],
    activeMeet: null,
    selectedMeet: null,
    shownMeetName: null,
    keepsStoredMeet: false,
    choseFromCache: false,
    stored: null,
    storedDetailsRaw: null,
    now,
  };

  describe('decideFromCachedList', () => {
    it('opens the cached choice at launch', () => {
      const decision = decideFromCachedList({ cachedMeets: [ended, ongoing], stored: 'Ended', selectedMeet: null, now });
      expect(decision).toMatchObject({ select: ongoing, activeMeet: 'Ongoing', paintCachedList: true, lookUpStoredMeet: false });
    });

    it('keeps a meet selected this session without selecting it again', () => {
      const decision = decideFromCachedList({ cachedMeets: [ongoing, later], stored: null, selectedMeet: 'Later', now });
      expect(decision).toMatchObject({ select: null, activeMeet: 'Later' });
    });

    it('waits for the lookup of a stored meet the cached list does not have', () => {
      const decision = decideFromCachedList({ cachedMeets: [ongoing], stored: 'Archived', selectedMeet: null, now });
      expect(decision).toMatchObject({ select: null, activeMeet: null, lookUpStoredMeet: true, resolving: true });
    });

    it('looks up the stored meet with no cached list, without showing it as resolving', () => {
      const decision = decideFromCachedList({ cachedMeets: [], stored: 'Archived', selectedMeet: null, now });
      expect(decision).toMatchObject({ paintCachedList: false, lookUpStoredMeet: true, resolving: false });
    });
  });

  describe('decideAfterStoredMeetLookup', () => {
    it('opens a stored meet the lookup found, and keeps its details', () => {
      const decision = decideAfterStoredMeetLookup({ stored: 'Archived', found: archived, lookupFailed: false, cachedMeets: [ongoing], now });
      expect(decision).toEqual({ select: archived, persistDetails: archived, clearStored: false, keepsStoredMeet: true });
    });

    it('forgets a stored meet the lookup says is gone and opens the cached choice', () => {
      const decision = decideAfterStoredMeetLookup({ stored: 'Archived', found: null, lookupFailed: false, cachedMeets: [ended, ongoing], now });
      expect(decision).toEqual({ select: ongoing, persistDetails: null, clearStored: true, keepsStoredMeet: false });
    });

    it('passes over an ended stored meet the lookup found', () => {
      const decision = decideAfterStoredMeetLookup({ stored: 'Ended', found: ended, lookupFailed: false, cachedMeets: [ongoing], now });
      expect(decision).toMatchObject({ select: ongoing, clearStored: true, keepsStoredMeet: false });
    });

    it('offline, keeps the stored keys and opens an ended persisted copy only when every cached meet is over too', () => {
      const allOver = decideAfterStoredMeetLookup({ stored: 'Ended', found: ended, lookupFailed: true, cachedMeets: [meet('Old', JUNE)], now });
      expect(allOver).toMatchObject({ select: ended, clearStored: false, keepsStoredMeet: true });
      const oneLeft = decideAfterStoredMeetLookup({ stored: 'Ended', found: ended, lookupFailed: true, cachedMeets: [ongoing], now });
      expect(oneLeft).toMatchObject({ select: ongoing, clearStored: false, keepsStoredMeet: false });
    });
  });

  describe('decideAfterFreshList', () => {
    it('stops with no meets', () => {
      expect(decideAfterFreshList({ ...freshListInput, freshMeets: [] })).toEqual({ kind: 'noMeets' });
    });

    it('keeps a stored meet this run already found by name', () => {
      expect(decideAfterFreshList({ ...freshListInput, activeMeet: 'Archived', keepsStoredMeet: true })).toEqual({ kind: 'keepSelection' });
    });

    it('keeps an unlisted meet selected this session whose details are shown', () => {
      const input = { ...freshListInput, activeMeet: 'Archived', selectedMeet: 'Archived', shownMeetName: 'Archived' };
      expect(decideAfterFreshList(input)).toEqual({ kind: 'keepSelection' });
    });

    it('looks up an active meet the fresh list no longer has', () => {
      expect(decideAfterFreshList({ ...freshListInput, activeMeet: 'Ended' })).toEqual({ kind: 'lookUpActiveMeet', meet: 'Ended' });
    });

    it('refreshes a listed meet and rewrites its persisted details only when they changed', () => {
      const listed = { ...later, venueMapPdfUrl: null, venueMapAppleUrl: null };
      const moved = { ...listed, venue: { ...listed.venue, name: 'New Hall' } };
      const input = { ...freshListInput, freshMeets: [ongoing, moved], activeMeet: 'Later' };
      expect(decideAfterFreshList({ ...input, storedDetailsRaw: JSON.stringify(listed) })).toMatchObject({
        kind: 'listed',
        refreshShownDetails: true,
        persistDetails: moved,
        select: null,
      });
      expect(decideAfterFreshList({ ...input, storedDetailsRaw: JSON.stringify(moved) })).toMatchObject({ persistDetails: null });
      expect(decideAfterFreshList(input)).toMatchObject({ persistDetails: null });
    });

    it('chooses from the fresh list only when nothing was chosen yet', () => {
      expect(decideAfterFreshList(freshListInput)).toMatchObject({ kind: 'listed', refreshShownDetails: false, select: ongoing });
      expect(decideAfterFreshList({ ...freshListInput, choseFromCache: true })).toMatchObject({ select: null });
    });
  });

  describe('decideAfterActiveMeetLookup', () => {
    it('keeps a found meet and persists its details', () => {
      const decision = decideAfterActiveMeetLookup({ found: archived, selectedMeet: null, freshMeets: [ongoing], now });
      expect(decision).toEqual({ select: archived, persistDetails: archived, clearStored: false });
    });

    it('keeps an ended meet only when it was selected this session', () => {
      expect(decideAfterActiveMeetLookup({ found: ended, selectedMeet: 'Ended', freshMeets: [ongoing], now })).toMatchObject({ select: ended });
      expect(decideAfterActiveMeetLookup({ found: ended, selectedMeet: null, freshMeets: [ongoing], now })).toEqual({
        select: ongoing,
        persistDetails: null,
        clearStored: true,
      });
    });

    it('forgets a meet that is gone and opens the first meet that is not over', () => {
      const decision = decideAfterActiveMeetLookup({ found: null, selectedMeet: 'Archived', freshMeets: [ended, later], now });
      expect(decision).toEqual({ select: later, persistDetails: null, clearStored: true });
    });
  });
});
