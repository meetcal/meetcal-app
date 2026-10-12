import {
  entriesEndpoint,
  entriesEventId,
  entryFromRow,
  lastNameOf,
  meetFromTitle,
  placeholderMemberId,
  unstoredEntriesMessage,
} from '../../convex/scrapers/parse/entries';
import { truncatedEntryRow } from '../../convex/ingest';
import { entriesMeet, meetsForSync, truncatedEntryNames } from '../../convex/scrapers/queries';
import { fakeMutationCtx, handlerOf as fakeHandlerOf } from '../fakeDb';

// Convex attaches the handler at runtime but omits it from its public types.
function handlerOf(registered: unknown): (ctx: unknown, args: unknown) => Promise<unknown> {
  if (typeof registered !== 'function' || !('_handler' in registered) || typeof registered._handler !== 'function') {
    throw new Error('Missing Convex handler');
  }
  return registered._handler as (ctx: unknown, args: unknown) => Promise<unknown>;
}

describe('Sport80 entries (replaces csv_scraper.js)', () => {
  it('finds the data endpoint behind an entries page', () => {
    expect(entriesEndpoint('https://usaweightlifting.sport80.com/public/events/14725/entries/21608?bl=')).toBe(
      'https://usaweightlifting.sport80.com/api/public/events/datatable/14725/entries/21608',
    );
    expect(() => entriesEndpoint('https://usaweightlifting.sport80.com/public/events/14725')).toThrow('not a Sport80 entries page');
  });

  it('names the meet from the table title', () => {
    expect(meetFromTitle('2026 New England WSO Championships - Members')).toBe('2026 New England WSO Championships');
    expect(meetFromTitle('2026 Virus Weightlifting Finals')).toBe('2026 Virus Weightlifting Finals');
  });

  it('builds entries as the browser scraper did', () => {
    const row = {
      id: 1,
      member_id: '1085301',
      first_name: 'Delaney',
      last_name: 'Mullen (She/her/hers/herself)',
      weightlifting_age: 13,
      club: 'Wormtown Weightlifting',
      gender: 'Female',
      weight_class: '+61',
      entry_total: 78,
    };
    expect(entryFromRow(row, 'Meet')).toEqual({
      memberId: '1085301',
      name: 'Delaney Mullen',
      age: 13,
      club: 'Wormtown Weightlifting',
      gender: 'Female',
      weightClass: '+61',
      entryTotal: 78,
      meet: 'Meet',
    });
    expect(entryFromRow({ ...row, member_id: '', entry_total: null, weightlifting_age: '' }, 'Meet')).toMatchObject({ memberId: 'noid:delaney-mullen', age: 0, entryTotal: 0 });
  });

  it('keeps every word of a surname and drops only the pronouns', () => {
    expect(lastNameOf('De La Cruz')).toBe('De La Cruz');
    expect(lastNameOf(' Van  Dyke ')).toBe('Van Dyke');
    expect(lastNameOf('Mullen (She/her)')).toBe('Mullen');
    expect(lastNameOf('Mullen (She/her')).toBe('Mullen');
    expect(lastNameOf('De La Cruz (they/them)')).toBe('De La Cruz');
    expect(lastNameOf(null)).toBe('');
    const row = { member_id: '', first_name: 'Maria', last_name: 'De La Cruz', gender: 'Female' };
    expect(entryFromRow(row, 'Meet')).toMatchObject({ name: 'Maria De La Cruz', memberId: 'noid:maria-de-la-cruz' });
    expect(entryFromRow({ ...row, first_name: 'Ann', last_name: 'Van Dyke' }, 'Meet').name).toBe('Ann Van Dyke');
  });

  it('finds the row the old scraper stored with the surname cut short', () => {
    const stored = [
      { memberId: '100', name: 'Maria De', gender: 'Female', age: 30 },
      { memberId: 'noid:ann-van', name: 'Ann Van', gender: 'Women', age: 17 },
      { memberId: '300', name: 'Bob Smith', gender: 'Male', age: 40 },
    ];
    // The caller passes the normalized gender; stored rows may still hold the
    // older spelling (`Female`), which matches too.
    const incoming = new Set(['maria de la cruz', 'ann van dyke']);
    expect(truncatedEntryRow(stored, { memberId: '100', age: 31 }, 'maria de la cruz', 'Women', incoming)).toBe(stored[0]);
    expect(truncatedEntryRow(stored, { memberId: 'noid:ann-van-dyke', age: 17 }, 'ann van dyke', 'Women', incoming)).toBe(stored[1]);
    // Without a membership number, a different age is someone else.
    expect(truncatedEntryRow(stored, { memberId: 'noid:ann-van-dyke', age: 18 }, 'ann van dyke', 'Women', incoming)).toBeUndefined();
    // A different membership number, gender, or a name that is not a whole-word prefix is someone else.
    expect(truncatedEntryRow(stored, { memberId: '999', age: 30 }, 'maria de la cruz', 'Women', incoming)).toBeUndefined();
    expect(truncatedEntryRow(stored, { memberId: 'noid:ann-van-dyke', age: 17 }, 'ann van dyke', 'Men', incoming)).toBeUndefined();
    expect(truncatedEntryRow(stored, { memberId: '300', age: 40 }, 'bob smithson', 'Men', incoming)).toBeUndefined();
    // A shorter name still on the list is its own entrant.
    expect(truncatedEntryRow(stored, { memberId: '100', age: 30 }, 'maria de la cruz', 'Women', new Set([...incoming, 'maria de']))).toBeUndefined();
    // Two candidates is ambiguous.
    const twice = [...stored, { memberId: 'noid:ann', name: 'Ann', gender: 'Female', age: 17 }];
    expect(truncatedEntryRow(twice, { memberId: 'noid:ann-van-dyke', age: 17 }, 'ann van dyke', 'Women', incoming)).toBeUndefined();
  });

  it('lists stored entry rows cut short beside their full-name twins', async () => {
    const athletes = [
      { _id: 'a1', name: 'Maria De', memberId: '100' },
      { _id: 'a2', name: 'Maria De La Cruz', memberId: '100' },
      { _id: 'a3', name: 'Ann Van', memberId: 'noid:ann-van' },
      { _id: 'a4', name: 'Ann Van Dyke', memberId: 'noid:ann-van-dyke' },
      { _id: 'a5', name: 'Bob Smith', memberId: '300' },
      { _id: 'a6', name: 'Bob Smith Jones', memberId: '301' },
    ];
    const ctx = {
      db: {
        query: (table: string) =>
          table === 'meets'
            ? { paginate: async () => ({ page: [{ name: 'M' }], continueCursor: 'next', isDone: true }) }
            : { withIndex: () => ({ collect: async () => athletes }) },
      },
    };
    const result = await handlerOf(truncatedEntryNames)(ctx, {});
    expect(result).toEqual({
      pairs: [
        { meet: 'M', truncated: { id: 'a1', name: 'Maria De', memberId: '100' }, full: { id: 'a2', name: 'Maria De La Cruz', memberId: '100' } },
        { meet: 'M', truncated: { id: 'a3', name: 'Ann Van', memberId: 'noid:ann-van' }, full: { id: 'a4', name: 'Ann Van Dyke', memberId: 'noid:ann-van-dyke' } },
      ],
      cursor: 'next',
      isDone: true,
    });
  });

  it('mints the same placeholder ids as the shared rule', () => {
    expect(placeholderMemberId('  José   de la Cruz ')).toBe('noid:jos-de-la-cruz');
    expect(placeholderMemberId('')).toBe('noid:');
  });
});

describe("an entries list's meet (#413, #252)", () => {
  const NJ = '2026 New Jersey WSO Championship (NUQ)';
  const NJ_NEW = '2026 New Jersey State Championship (NUQ)';
  const meet = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    venueName: 'Gym',
    venueStreet: '',
    venueCity: 'Tinton Falls',
    venueState: 'NJ',
    venueZip: '07712',
    timeZone: 'America/New_York',
    startDate: '2026-10-24',
    endDate: '2026-10-25',
    status: 'upcoming',
    federation: 'USAW',
    updatedAt: 1,
    ...extra,
  });
  const lookup = fakeHandlerOf<{ sourceId: string; title: string }, unknown>(entriesMeet);

  it('reads the event id from the entries page', () => {
    expect(entriesEventId('https://usaweightlifting.sport80.com/public/events/14836/entries/21710?bl=')).toBe('14836');
  });

  it('is the meet stored under the list event id, whatever Sport80 titles the list now', async () => {
    const { ctx } = fakeMutationCtx({ meets: [meet(NJ, { sourceId: '14836' })] });
    expect(await lookup(ctx, { sourceId: '14836', title: NJ_NEW })).toEqual({ name: NJ, status: 'upcoming', endDate: '2026-10-25' });
  });

  it("is the meet named by the list's title, unless Sport80 knows that meet by another id", async () => {
    const { ctx } = fakeMutationCtx({ meets: [meet(NJ), meet('Halloweenie', { sourceId: '13000' })] });
    expect(await lookup(ctx, { sourceId: '14836', title: NJ })).toMatchObject({ name: NJ });
    expect(await lookup(ctx, { sourceId: '15060', title: 'Halloweenie' })).toBeNull();
    expect(await lookup(ctx, { sourceId: '14836', title: NJ_NEW })).toBeNull();
  });

  it('says how to tie a retitled list to its stored meet, or drop the target', () => {
    const url = 'https://usaweightlifting.sport80.com/public/events/14836/entries/21710';
    const message = unstoredEntriesMessage(NJ_NEW, '14836', url);
    expect(message).toContain(`"${NJ_NEW}" (Sport80 event 14836) is no stored meet`);
    expect(message).toContain(`ingest:setMeetSourceId '{"name":"<stored name>","sourceId":"14836"}'`);
    expect(message).toContain(`scrapers/entryTargets:remove '{"url":"${url}"}'`);
  });
});

describe('the meet sync reads stored meets by event id (#413, #252)', () => {
  const sync = fakeHandlerOf<{ rows: { name: string; sourceId: string | null }[]; today: string }, { stored: unknown[]; unlisted: unknown[] }>(meetsForSync);
  const meet = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    venueName: 'Gym',
    venueStreet: '',
    venueCity: 'X',
    venueState: 'NJ',
    venueZip: '',
    timeZone: 'America/New_York',
    startDate: '2026-11-01',
    endDate: '2026-11-01',
    status: 'upcoming',
    federation: 'USAW',
    updatedAt: 1,
    ...extra,
  });

  it('finds each listed row by event id, else by name, and lists stored upcoming meets the listing lost', async () => {
    const { ctx } = fakeMutationCtx({
      meets: [
        meet('NJ', { sourceId: '14836' }),
        meet('Georgia'),
        meet('Cancelled', { sourceId: '99' }),
        meet('Tomorrow', { sourceId: '98', startDate: '2026-10-12' }),
        meet('Masters', { sourceId: '97', federation: 'USAMW' }),
        meet('Old', { sourceId: '96', status: 'completed', startDate: '2025-01-01', endDate: '2025-01-01' }),
      ],
    });
    const result = await sync(ctx, {
      rows: [
        { name: 'NJ retitled', sourceId: '14836' },
        { name: 'Georgia', sourceId: '15004' },
        { name: 'New', sourceId: '1' },
      ],
      today: '2026-10-12',
    });
    expect(result).toEqual({
      stored: [{ name: 'NJ', status: 'upcoming', bySource: true }, { name: 'Georgia', status: 'upcoming', bySource: false }, null],
      // Not one starting today, of another federation, or completed.
      unlisted: [{ name: 'Cancelled', sourceId: '99', startDate: '2026-11-01' }],
    });
  });
});
