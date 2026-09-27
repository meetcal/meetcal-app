import { entriesEndpoint, entryFromRow, meetFromTitle, placeholderMemberId } from '../../convex/scrapers/parse/entries';

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

  it('mints the same placeholder ids as the shared rule', () => {
    expect(placeholderMemberId('  José   de la Cruz ')).toBe('noid:jos-de-la-cruz');
    expect(placeholderMemberId('')).toBe('noid:');
  });
});
