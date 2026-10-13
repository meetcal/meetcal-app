import { formatVenueLocation, venueAddressLines } from '@/lib/venue-address';

const venue = (name: string, street: string, city: string, state: string, zip: string) => ({
  name,
  address: { street, city, state, zip },
});

describe('formatVenueLocation', () => {
  it('joins a full address', () => {
    expect(formatVenueLocation(venue('Arena', '1 Main St', 'Columbus', 'OH', '43215'), 'Open')).toBe(
      'Arena, 1 Main St, Columbus, OH 43215',
    );
  });

  // #282: the backend's NO_VENUE, with the meet's own name as the venue.
  it('is empty for a meet scraped without an address', () => {
    expect(formatVenueLocation(venue('Fall Open', '', 'Unknown', 'Unknown', 'Unknown'), 'Fall Open')).toBe('');
    expect(formatVenueLocation(venue('', '', '', '', ''), 'Fall Open')).toBe('');
    expect(formatVenueLocation(null, 'Fall Open')).toBe('');
  });

  it('keeps a real venue name without an address', () => {
    expect(formatVenueLocation(venue('Arena', '', 'Unknown', 'unknown', ''), 'Fall Open')).toBe('Arena');
  });

  it('leaves out blank and placeholder parts', () => {
    expect(formatVenueLocation(venue('Arena', ' ', 'Columbus', 'Unknown', '43215'), 'Open')).toBe(
      'Arena, Columbus, 43215',
    );
    expect(formatVenueLocation(venue('Fall Open', '', 'Columbus', 'OH', 'Unknown'), 'Fall Open')).toBe(
      'Fall Open, Columbus, OH',
    );
  });
});

describe('venueAddressLines', () => {
  it('gives display lines with placeholders blanked', () => {
    expect(venueAddressLines(venue('Arena', '1 Main St', 'Unknown', 'OH', 'Unknown'))).toEqual({
      name: 'Arena',
      street: '1 Main St',
      locality: 'OH',
    });
    expect(venueAddressLines(undefined)).toEqual({ name: '', street: '', locality: '' });
  });
});
