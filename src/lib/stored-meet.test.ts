import { mapApiMeet } from '@/lib/api/api-meet-mappers';
import { parseStoredMeetNamed } from './stored-meet';

const stored = mapApiMeet({
  id: 'meet-1',
  name: 'Old Nationals',
  start_date: '2026-06-20',
  end_date: '2026-06-28',
  time_zone: 'America/Chicago',
  venue_name: 'Convention Center',
  venue_street: '1 Main St',
  venue_city: 'Omaha',
  venue_state: 'NE',
  venue_zip: '68102',
  venue_map_pdf_url: null,
  venue_map_apple_url: 'https://maps.apple.com/?q=x',
  status: 'upcoming',
});

function without(path: string[]): string {
  const copy = JSON.parse(JSON.stringify(stored));
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key];
  delete target[path[path.length - 1]];
  return JSON.stringify(copy);
}

describe('parseStoredMeetNamed', () => {
  it('reads back a meet the API mapper built', () => {
    const { timeZoneUnknown: _flag, ...meet } = stored;
    expect(parseStoredMeetNamed(JSON.stringify(stored), 'Old Nationals')).toEqual(meet);
  });

  it('ignores a stored meet with another name, no value and text that is not JSON', () => {
    expect(parseStoredMeetNamed(JSON.stringify(stored), 'Another Meet')).toBeNull();
    expect(parseStoredMeetNamed(null, 'Old Nationals')).toBeNull();
    expect(parseStoredMeetNamed('{"name":', 'Old Nationals')).toBeNull();
  });

  it.each([
    [['venue']],
    [['venue', 'address', 'street']],
    [['time', 'timeZoneIdentifier']],
    [['time', 'utcOffset']],
    [['dates', 'end']],
    [['status']],
    [['id']],
  ])('ignores a stored meet missing %j', (path) => {
    expect(parseStoredMeetNamed(without(path), 'Old Nationals')).toBeNull();
  });

  it('ignores a stored meet whose zone the device cannot read', () => {
    const copy = JSON.parse(JSON.stringify(stored));
    copy.time.timeZoneIdentifier = 'Mars/Olympus';
    expect(parseStoredMeetNamed(JSON.stringify(copy), 'Old Nationals')).toBeNull();
  });

  it('keeps the unknown-zone flag', () => {
    expect(parseStoredMeetNamed(JSON.stringify({ ...stored, timeZoneUnknown: true }), 'Old Nationals')?.timeZoneUnknown).toBe(true);
  });
});
