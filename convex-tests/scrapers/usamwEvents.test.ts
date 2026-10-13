import { parseDates, parseLocation, parseUsamwEvents, timeZoneFor, type UsamwEvent } from '../../convex/scrapers/parse/usamwEvents';
import { usamwEventFailures } from '../../convex/scrapers/usamwEvents';
import { afterRun, describeFailure, sourcesFailed } from '../../convex/lib/cronAlerts';

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
    expect(timeZoneFor('TN', 'Knoxville')).toBe('America/New_York');
    expect(timeZoneFor('Barcelona', 'Barcelona', 'Barcelona - SPAIN')).toBe('Europe/Madrid');
    // Neither a state nor a known country: no zone, rather than Eastern.
    expect(timeZoneFor('TBD', 'TBD', 'TBD')).toBeUndefined();
  });

  it('reads each event block, skipping training camps', () => {
    const html = [
      block('2026 IMWA World Masters<br>Athens, Greece<br>Sep 17-26, 2026<br><br>Adaptive Info: someone', '<br><br>**Participating athletes will be REQUIRED to wear an appropriate singlet which meets all IMWA standards.'),
      block('USA Masters Training Camp<br>Oct 2-3, 2026', 'Port Charlotte, FL'),
      block('2026 Howard Cohen<br>American Masters<br><br>Dec 2-6, 2026<br><br>Book Hotel here', 'Valley Forge, PA<br><br>Valley Forge Resort &amp; Casino<br><br>Registration fees per lifter<br>$ 169.00'),
      block('2027 Elite Masters<br><br>August 18-22', 'Savannah, GA<br>Olympic Legacy Facility'),
      block('2028 IMWA World Masters<br><br>July 31-Aug 08, 2028', 'Corbera de Llobregat<br>Barcelona - SPAIN'),
      block('2027 Masters Open<br>Mar 3, 2027', ''),
    ].join('');
    expect(parseUsamwEvents(html)).toEqual([
      { name: '2026 IMWA World Masters', startDate: '2026-09-17', endDate: '2026-09-26', venueName: 'TBD', venueCity: 'Athens', venueState: 'Greece', timeZone: 'Europe/Athens' },
      { name: '2026 Howard Cohen American Masters', startDate: '2026-12-02', endDate: '2026-12-06', venueName: 'Valley Forge Resort & Casino', venueCity: 'Valley Forge', venueState: 'PA', timeZone: 'America/New_York' },
      { name: '2027 Elite Masters', startDate: '2027-08-18', endDate: '2027-08-22', venueName: 'Olympic Legacy Facility', venueCity: 'Savannah', venueState: 'GA', timeZone: 'America/New_York' },
      { name: '2028 IMWA World Masters', startDate: '2028-07-31', endDate: '2028-08-08', venueName: 'TBD', venueCity: 'Corbera de Llobregat', venueState: 'Spain', timeZone: 'Europe/Madrid' },
      // No location yet: no zone (the sync keeps a stored one), not Eastern.
      { name: '2027 Masters Open', startDate: '2027-03-03', endDate: '2027-03-03', venueName: 'TBD', venueCity: 'TBD', venueState: 'TBD' },
    ]);
  });

  describe('problems that need a person (#254)', () => {
    const event = (name: string): UsamwEvent => ({ name, startDate: '2027-03-03', endDate: '2027-03-05', venueName: 'TBD', venueCity: 'TBD', venueState: 'TBD' });
    const events = [event('Spring Open'), event('2027 Masters Open'), event('2027 Masters Open 2')];

    it('names one stable source per ambiguous event and per renamed meet', () => {
      const failures = usamwEventFailures(events, {
        ambiguous: ['Spring Open: Meet A / Meet B'],
        renamed: ['2027 Masters Open (USAMW)', '2027 Masters Open 2 (USAMW 2)'],
      });
      expect(failures.map((f) => f.source)).toEqual(['event Spring Open', 'meet 2027 Masters Open', 'meet 2027 Masters Open 2']);
      expect(failures[0].error).toContain('Meet A / Meet B');
      expect(failures[1].error).toContain('"2027 Masters Open (USAMW)"');
      expect(usamwEventFailures(events, { ambiguous: [], renamed: [] })).toEqual([]);
    });

    it('emails a rename that turns up while an ambiguous event keeps the job failing', () => {
      const day1 = describeFailure(sourcesFailed('usamw events', usamwEventFailures(events, { ambiguous: ['Spring Open: Meet A / Meet B'], renamed: [] })));
      const first = afterRun('usamw-events', undefined, { ok: false, ...day1 });
      expect(first.notice?.kind).toBe('failed');
      const day2 = describeFailure(
        sourcesFailed('usamw events', usamwEventFailures(events, { ambiguous: ['Spring Open: Meet A / Meet B'], renamed: ['2027 Masters Open (USAMW)'] })),
      );
      const second = afterRun('usamw-events', first.alerting, { ok: false, ...day2 }, first.failedSources);
      expect(second.notice?.detail).toContain('now also failing: meet 2027 Masters Open');
      // The same problems again send nothing more.
      expect(afterRun('usamw-events', second.alerting, { ok: false, ...day2 }, second.failedSources).notice).toBeUndefined();
    });
  });
});
