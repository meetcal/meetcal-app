import { scrapedMeetValues } from '../convex/ingest';
import { padMeetDates } from '../convex/migrations';
import { canonicalMeetDate, isKnownTimeZone } from '../convex/lib/validation';
import { meetDataProblems } from '../convex/scrapers/queries';
import type { Doc, Id } from '../convex/_generated/dataModel';

// Convex attaches the handler at runtime but omits it from its public types.
function handlerOf(registered: unknown): (ctx: unknown, args: unknown) => Promise<unknown> {
  if (typeof registered !== 'function' || !('_handler' in registered) || typeof registered._handler !== 'function') {
    throw new Error('Missing Convex handler');
  }
  return registered._handler as (ctx: unknown, args: unknown) => Promise<unknown>;
}

function meet(overrides: Partial<Doc<'meets'>> = {}): Doc<'meets'> {
  return {
    _id: 'meet1' as Id<'meets'>,
    _creationTime: 0,
    name: 'Meet',
    venueName: 'Gym',
    venueStreet: '1 Main St',
    venueCity: 'Nashville',
    venueState: 'TN',
    venueZip: '37210',
    timeZone: 'America/Chicago',
    startDate: '2026-10-17',
    endDate: '2026-10-17',
    status: 'upcoming',
    federation: 'USAW',
    updatedAt: 0,
    ...overrides,
  };
}

const scraped = {
  name: 'Meet',
  venueName: 'Gym',
  venueStreet: '1 Main St',
  venueCity: 'Knoxville',
  venueState: 'TN',
  venueZip: '37902',
  timeZone: 'America/New_York',
  startDate: '2026-10-17',
  endDate: '2026-10-17',
  status: 'upcoming' as const,
  federation: 'USAW',
};

describe('stored meet dates', () => {
  it('reads padded, unpadded and malformed dates', () => {
    expect(canonicalMeetDate('2026-10-17')).toBe('2026-10-17');
    expect(canonicalMeetDate('2026-9-5')).toBe('2026-09-05');
    expect(canonicalMeetDate('undefined-TBD-undefined')).toBeNull();
    expect(canonicalMeetDate('2026-02-30')).toBeNull();
    expect(canonicalMeetDate('')).toBeNull();
  });

  it('pads stored dates and lists the ones that are not dates, leaving them alone', async () => {
    const meets = [
      meet({ _id: 'fine' as Id<'meets'>, name: 'Fine' }),
      meet({ _id: 'unpadded' as Id<'meets'>, name: 'Unpadded', startDate: '2026-9-5', endDate: '2026-9-6' }),
      meet({ _id: 'tbd' as Id<'meets'>, name: 'TBD', startDate: 'undefined-TBD-undefined', endDate: 'undefined-TBD-undefined' }),
    ];
    const patch = jest.fn();
    const insert = jest.fn();
    const runAfter = jest.fn();
    const ctx = {
      db: {
        query: (table: string) =>
          table === 'meets'
            ? { collect: async () => meets }
            : { withIndex: () => ({ first: async () => null, unique: async () => null }) },
        patch,
        insert,
      },
      scheduler: { runAfter },
    };
    expect(await handlerOf(padMeetDates)(ctx, {})).toEqual({ padded: ['Unpadded'], unreadable: ['TBD'] });
    const meetPatches = patch.mock.calls.filter(([id]) => id === 'unpadded');
    expect(meetPatches).toEqual([['unpadded', expect.objectContaining({ startDate: '2026-09-05', endDate: '2026-09-06' })]]);
    expect(patch.mock.calls.some(([id]) => id === 'fine' || id === 'tbd')).toBe(false);
    // The write leaves a hint for the meet's views and schedules a refresh.
    expect(insert).toHaveBeenCalledWith('view_hints', expect.objectContaining({ kind: 'meet', key: 'Unpadded' }));
    expect(runAfter).toHaveBeenCalledTimes(1);
  });

  it('knows IANA zones', () => {
    expect(isKnownTimeZone('America/New_York')).toBe(true);
    expect(isKnownTimeZone('')).toBe(false);
    expect(isKnownTimeZone('Not/AZone')).toBe(false);
  });
});

describe('scraped meet values', () => {
  it('stores a new meet with its zone, or a blank one when the scraper could not tell', () => {
    expect(scrapedMeetValues(scraped, null)).toMatchObject({ timeZone: 'America/New_York', federation: 'USAW' });
    const { timeZone: _zone, ...noZone } = scraped;
    expect(scrapedMeetValues(noZone, null).timeZone).toBe('');
  });

  it('updates the zone of a stored meet unless it was set by hand or the scraper could not tell', () => {
    expect(scrapedMeetValues(scraped, meet()).timeZone).toBe('America/New_York');
    expect('timeZone' in scrapedMeetValues(scraped, meet({ timeZoneLocked: true }))).toBe(false);
    const { timeZone: _zone, ...noZone } = scraped;
    expect('timeZone' in scrapedMeetValues(noZone, meet())).toBe(false);
  });

  it('keeps a completed meet completed', () => {
    expect(scrapedMeetValues(scraped, meet({ status: 'completed' })).status).toBe('completed');
  });
});

describe('scraped data problems', () => {
  it('lists malformed dates, unknown zones and zones the state and city now place elsewhere', async () => {
    const meets = [
      meet({ name: 'Fine' }),
      meet({ name: 'TBD dates', startDate: 'undefined-TBD-undefined', endDate: 'undefined-TBD-undefined' }),
      meet({ name: 'Unpadded', startDate: '2026-9-5', endDate: '2026-09-06' }),
      meet({ name: 'No zone', timeZone: '' }),
      meet({ name: 'Knoxville', venueCity: 'Knoxville' }),
      meet({ name: 'Knoxville locked', venueCity: 'Knoxville', timeZoneLocked: true }),
      meet({ name: 'Abroad', venueState: 'Greece', venueCity: 'Athens', timeZone: 'Europe/Athens' }),
    ];
    const ctx = { db: { query: () => ({ collect: async () => meets }) } };
    const result = await handlerOf(meetDataProblems)(ctx, {});
    expect(result).toEqual({
      badDates: [
        { name: 'TBD dates', status: 'upcoming', startDate: 'undefined-TBD-undefined', endDate: 'undefined-TBD-undefined' },
        { name: 'Unpadded', status: 'upcoming', startDate: '2026-9-5', endDate: '2026-09-06' },
      ],
      unknownZone: [{ name: 'No zone', status: 'upcoming', timeZone: '', venueCity: 'Nashville', venueState: 'TN' }],
      zoneDiffers: [{ name: 'Knoxville', status: 'upcoming', timeZone: 'America/Chicago', derived: 'America/New_York', venueCity: 'Knoxville', venueState: 'TN' }],
    });
  });
});
