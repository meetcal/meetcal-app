import { parseAddress, parseDateRange, transformMeets } from '../../convex/scrapers/parse/meets';

describe('meet sync (port of sync-meets.js / sync-nat-meets.js / sync-virus-meets.js)', () => {
  it('parses Sport80 addresses the way the Node scripts did', () => {
    expect(parseAddress('USF Campus Recreation Center, 12301 USF Genshaft Drive, Tampa, Florida, United States of America, 33620')).toEqual({
      venueName: 'USF Campus Recreation Center', street: '12301 USF Genshaft Drive', city: 'Tampa', state: 'Florida', zip: '33620',
    });
    expect(parseAddress('Gym, 1 Main St, Suite 4, Austin, Texas, United States of America, 78701')).toMatchObject({
      street: '1 Main St, Suite 4', city: 'Austin', state: 'Texas',
    });
    expect(parseAddress('12 Oak Rd, Reno, Nevada, 89501')).toEqual({ venueName: '', street: '12 Oak Rd', city: 'Reno', state: 'Nevada', zip: '89501' });
    expect(parseAddress('TBD')).toEqual({ venueName: '', street: 'TBD', city: 'Unknown', state: 'Unknown', zip: 'Unknown' });
    expect(parseAddress('A, , B, C, D')).toMatchObject({ venueName: 'A', street: 'B' });
  });

  it('turns MM/DD/YYYY ranges (escaped slashes too) into ISO dates', () => {
    expect(parseDateRange('09/25/2026 - 09/27/2026')).toEqual({ startDate: '2026-09-25', endDate: '2026-09-27' });
    expect(parseDateRange('12\\/03\\/2026')).toEqual({ startDate: '2026-12-03', endDate: '2026-12-03' });
  });

  it('maps states, defaults the venue to the meet name, and drops adaptive meets', () => {
    const rows = [
      { name: 'Hawaii Open', address: '1 Beach Rd, Honolulu, Hawaii, United States of America, 96815', subtitle: '10/01/2026 - 10/02/2026' },
      { name: 'Adaptive Nationals', address: 'X, 1 A St, B, Ohio, United States of America, 43004', subtitle: '10/01/2026' },
      { name: 'Unknown Land', address: 'Hall, 1 A St, Town, Atlantis, 00000', subtitle: '11/01/2026 - 11/01/2026' },
    ];
    expect(transformMeets(rows)).toEqual([
      { name: 'Hawaii Open', venueName: 'Hawaii Open', venueStreet: '1 Beach Rd', venueCity: 'Honolulu', venueState: 'HI', venueZip: '96815', timeZone: 'Pacific/Honolulu', startDate: '2026-10-01', endDate: '2026-10-02', status: 'upcoming', federation: 'USAW' },
      { name: 'Unknown Land', venueName: 'Hall', venueStreet: '1 A St', venueCity: 'Town', venueState: 'Atlantis', venueZip: '00000', timeZone: 'America/New_York', startDate: '2026-11-01', endDate: '2026-11-01', status: 'upcoming', federation: 'USAW' },
    ]);
  });
});
