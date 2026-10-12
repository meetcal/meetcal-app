import { entriesEndpoint, entryFromRow, lastNameOf, meetFromTitle, placeholderMemberId } from '../../convex/scrapers/parse/entries';
import { truncatedEntryRow } from '../../convex/ingest';
import { truncatedEntryNames } from '../../convex/scrapers/queries';

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
      { memberId: '100', name: 'Maria De', gender: 'Female' },
      { memberId: 'noid:ann-van', name: 'Ann Van', gender: 'Female' },
      { memberId: '300', name: 'Bob Smith', gender: 'Male' },
    ];
    const incoming = new Set(['maria de la cruz', 'ann van dyke']);
    expect(truncatedEntryRow(stored, { memberId: '100' }, 'maria de la cruz', 'Female', incoming)).toBe(stored[0]);
    expect(truncatedEntryRow(stored, { memberId: 'noid:ann-van-dyke' }, 'ann van dyke', 'Female', incoming)).toBe(stored[1]);
    // A different membership number, gender, or a name that is not a whole-word prefix is someone else.
    expect(truncatedEntryRow(stored, { memberId: '999' }, 'maria de la cruz', 'Female', incoming)).toBeUndefined();
    expect(truncatedEntryRow(stored, { memberId: 'noid:ann-van-dyke' }, 'ann van dyke', 'Male', incoming)).toBeUndefined();
    expect(truncatedEntryRow(stored, { memberId: '300' }, 'bob smithson', 'Male', incoming)).toBeUndefined();
    // A shorter name still on the list is its own entrant.
    expect(truncatedEntryRow(stored, { memberId: '100' }, 'maria de la cruz', 'Female', new Set([...incoming, 'maria de']))).toBeUndefined();
    // Two candidates is ambiguous.
    const twice = [...stored, { memberId: 'noid:ann', name: 'Ann', gender: 'Female' }];
    expect(truncatedEntryRow(twice, { memberId: 'noid:ann-van-dyke' }, 'ann van dyke', 'Female', incoming)).toBeUndefined();
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
