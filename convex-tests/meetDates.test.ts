import { completeEndedMeets, scrapedMeetValues, setMeetTimeZone, upsertMeets } from '../convex/ingest';
import { padMeetDates } from '../convex/migrations';
import { APP_TIME_ZONES, canonicalMeetDate, isKnownTimeZone } from '../convex/lib/validation';
import { meetDataProblems } from '../convex/scrapers/queries';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { timezoneOffsets } from '../src/data/types/meet';

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

  it('completes a meet stored without a zone only once its last day has ended everywhere in the US', async () => {
    jest.useFakeTimers({ now: Date.UTC(2026, 9, 12, 5) }); // 1am Oct 12 in New York, 7pm Oct 11 in Honolulu
    try {
      const meets = [
        meet({ _id: 'ny' as Id<'meets'>, name: 'New York meet', timeZone: 'America/New_York', endDate: '2026-10-11' }),
        meet({ _id: 'blank' as Id<'meets'>, name: 'No zone', timeZone: '', endDate: '2026-10-11' }),
      ];
      const patch = jest.fn();
      const ctx = {
        db: {
          query: (table: string) => ({
            withIndex: (_name: string, build: (q: unknown) => unknown) => {
              let status = '';
              const q = { eq: (field: string, value: string) => { if (field === 'status') status = value; return q; } };
              build(q);
              return { collect: async () => (table === 'meets' && status === 'upcoming' ? meets : []), first: async () => null, unique: async () => null };
            },
          }),
          patch,
          insert: jest.fn(),
        },
        scheduler: { runAfter: jest.fn() },
      };
      expect(await handlerOf(completeEndedMeets)(ctx, {})).toBe(1);
      expect(patch.mock.calls.filter(([id]) => id === 'ny' || id === 'blank').map(([id]) => id)).toEqual(['ny']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps a completed meet completed', () => {
    expect(scrapedMeetValues(scraped, meet({ status: 'completed' })).status).toBe('completed');
  });

  describe('a meet scraped without an address', () => {
    const { venueName: _n, venueStreet: _s, venueCity: _c, venueState: _st, venueZip: _z, timeZone: _tz, ...noVenue } = scraped;
    /** `upsertMeets` over `stored` (null for none), with the db calls it made. */
    async function upsert(stored: Doc<'meets'> | null, row: object) {
      const patch = jest.fn();
      const insert = jest.fn();
      const ctx = {
        db: {
          query: (table: string) => ({ withIndex: () => ({ first: async () => (table === 'meets' ? stored : null), unique: async () => null }) }),
          patch,
          insert,
        },
        scheduler: { runAfter: jest.fn() },
      };
      const outcomes = await handlerOf(upsertMeets)(ctx, { rows: [row] });
      return { outcomes, patch, insert };
    }

    it('keeps the stored venue and zone', async () => {
      const unchanged = await upsert(meet(), noVenue);
      expect(unchanged.outcomes).toEqual([{ wasInsert: false, wasChanged: false }]);
      expect(unchanged.patch).not.toHaveBeenCalled();
      const moved = await upsert(meet(), { ...noVenue, endDate: '2026-10-18' });
      expect(moved.outcomes).toEqual([{ wasInsert: false, wasChanged: true }]);
      const [[, values]] = moved.patch.mock.calls.filter(([id]) => id === 'meet1');
      expect(values).toMatchObject({ endDate: '2026-10-18' });
      for (const key of ['venueName', 'venueStreet', 'venueCity', 'venueState', 'venueZip', 'timeZone']) expect(values).not.toHaveProperty(key);
    });

    it('stores a new one with placeholders', async () => {
      const { insert } = await upsert(null, noVenue);
      expect(insert).toHaveBeenCalledWith('meets', expect.objectContaining({
        name: 'Meet', venueName: 'Meet', venueStreet: '', venueCity: 'Unknown', venueState: 'Unknown', venueZip: 'Unknown', timeZone: '',
      }));
    });
  });
});

describe('setting a meet time zone by hand', () => {
  it('accepts exactly the zones the app can show', () => {
    expect([...APP_TIME_ZONES].sort()).toEqual(Object.keys(timezoneOffsets).sort());
  });

  it('refuses a zone the app would show in New York time', async () => {
    const ctx = { db: { query: jest.fn(), patch: jest.fn() } };
    await expect(handlerOf(setMeetTimeZone)(ctx, { name: 'Meet', timeZone: 'Europe/Madrid' })).rejects.toThrow('not a time zone the app can show');
    await expect(handlerOf(setMeetTimeZone)(ctx, { name: 'Meet', timeZone: 'Not/AZone' })).rejects.toThrow('not a time zone the app can show');
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('locks an app zone on the meet', async () => {
    const patch = jest.fn();
    const ctx = {
      db: {
        query: (table: string) => ({ withIndex: () => ({ first: async () => (table === 'meets' ? meet() : null), unique: async () => null }) }),
        patch,
        insert: jest.fn(),
      },
      scheduler: { runAfter: jest.fn() },
    };
    expect(await handlerOf(setMeetTimeZone)(ctx, { name: 'Meet', timeZone: 'America/New_York' })).toEqual({ changed: true });
    expect(patch).toHaveBeenCalledWith('meet1', expect.objectContaining({ timeZone: 'America/New_York', timeZoneLocked: true }));
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
