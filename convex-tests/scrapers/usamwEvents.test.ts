import { parseDates, parseLocation, parseUsamwEvents, timeZoneFor } from '../../convex/scrapers/parse/usamwEvents';

const block = (venue: string, location: string) =>
  `<div class="kv-ee-row kv-ee-event"><div class="kv-ee-venue"><p>${venue}<span style="display:none;"></span></p></div><div class="kv-ee-location"><p>${location}</p></div></div>`;

describe('USA Masters events (usamasters.net)', () => {
  it('parses date ranges, across months and with the year from the name', () => {
    expect(parseDates('Sep 17-26, 2026', null)).toEqual({ startDate: '2026-09-17', endDate: '2026-09-26' });
    expect(parseDates('July 31-Aug 08, 2028', null)).toEqual({ startDate: '2028-07-31', endDate: '2028-08-08' });
    expect(parseDates('Dec 30-Jan 2, 2026', null)).toEqual({ startDate: '2026-12-30', endDate: '2027-01-02' });
    expect(parseDates('August 18-22', 2027)).toEqual({ startDate: '2027-08-18', endDate: '2027-08-22' });
    expect(parseDates('August 18-22', null)).toBeNull();
    expect(parseDates('Qualifying Totals', 2027)).toBeNull();
  });

  it('reads locations and time zones', () => {
    expect(parseLocation('Valley Forge, PA')).toEqual({ venueCity: 'Valley Forge', venueState: 'PA' });
    expect(parseLocation('Little Rock, Arkansas')).toEqual({ venueCity: 'Little Rock', venueState: 'AR' });
    expect(parseLocation('Kansai, Japan')).toEqual({ venueCity: 'Kansai', venueState: 'Japan' });
    expect(timeZoneFor('TN')).toBe('America/Chicago');
    expect(timeZoneFor('Greece')).toBe('Europe/Athens');
    expect(timeZoneFor('PA')).toBe('America/New_York');
  });

  it('reads each event block, skipping training camps', () => {
    const html = [
      block('2026 IMWA World Masters<br>Athens, Greece<br>Sep 17-26, 2026<br><br>Adaptive Info: someone', '<br><br>**Participating athletes will be REQUIRED to wear an appropriate singlet which meets all IMWA standards.'),
      block('USA Masters Training Camp<br>Oct 2-3, 2026', 'Port Charlotte, FL'),
      block('2026 Howard Cohen<br>American Masters<br><br>Dec 2-6, 2026<br><br>Book Hotel here', 'Valley Forge, PA<br><br>Valley Forge Resort &amp; Casino<br><br>Registration fees per lifter<br>$ 169.00'),
      block('2027 Elite Masters<br><br>August 18-22', 'Savannah, GA<br>Olympic Legacy Facility'),
      block('2028 IMWA World Masters<br><br>July 31-Aug 08, 2028', 'Corbera de Llobregat<br>Barcelona - SPAIN'),
    ].join('');
    expect(parseUsamwEvents(html)).toEqual([
      { name: '2026 IMWA World Masters', startDate: '2026-09-17', endDate: '2026-09-26', venueName: 'TBD', venueCity: 'Athens', venueState: 'Greece', timeZone: 'Europe/Athens' },
      { name: '2026 Howard Cohen American Masters', startDate: '2026-12-02', endDate: '2026-12-06', venueName: 'Valley Forge Resort & Casino', venueCity: 'Valley Forge', venueState: 'PA', timeZone: 'America/New_York' },
      { name: '2027 Elite Masters', startDate: '2027-08-18', endDate: '2027-08-22', venueName: 'Olympic Legacy Facility', venueCity: 'Savannah', venueState: 'GA', timeZone: 'America/New_York' },
      { name: '2028 IMWA World Masters', startDate: '2028-07-31', endDate: '2028-08-08', venueName: 'TBD', venueCity: 'Corbera de Llobregat', venueState: 'Spain', timeZone: 'Europe/Madrid' },
    ]);
  });
});
