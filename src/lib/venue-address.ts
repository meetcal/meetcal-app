import type { Venue } from '@/data/types/meet';

/**
 * A meet's venue as text: the one formatter for the calendar event location
 * (`data/meets/config`) and the Info tab's address and Maps search
 * (`components/info/EventInfoScreen`). The two had their own copies, and they
 * had already diverged.
 *
 * A meet scraped without an address is stored with `'Unknown'` for its city,
 * state and zip and its own name as the venue name (`NO_VENUE` in
 * `convex/ingest.ts`), so every calendar event for it read
 * "<Meet>, , Unknown, Unknown Unknown", which Maps cannot resolve. Blank and
 * placeholder parts are left out here.
 */

/** The value the backend stores for an address part it does not know. */
const PLACEHOLDER_PART = 'unknown';

/** `value` trimmed, or "" when it is blank or a placeholder. */
function realPart(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.toLowerCase() === PLACEHOLDER_PART ? '' : trimmed;
}

/** The venue as display lines; "" for a line with nothing real on it. */
export interface VenueAddressLines {
  name: string;
  street: string;
  /** "City, ST 12345", from whichever of the three are known. */
  locality: string;
}

export function venueAddressLines(venue: Venue | null | undefined): VenueAddressLines {
  const address = venue?.address;
  const city = realPart(address?.city);
  const stateZip = [realPart(address?.state), realPart(address?.zip)].filter(Boolean).join(' ');
  return {
    name: realPart(venue?.name),
    street: realPart(address?.street),
    locality: [city, stateZip].filter(Boolean).join(', '),
  };
}

/**
 * The venue on one line ("Venue, 1 Main St, Columbus, OH 43215") from its
 * real parts only, or "" when there is no address to give: a venue name that
 * is only the meet's own name (`meetName`, the backend's stand-in) with no
 * street or locality names no place.
 */
export function formatVenueLocation(
  venue: Venue | null | undefined,
  meetName?: string | null,
): string {
  const { name, street, locality } = venueAddressLines(venue);
  const hasAddress = Boolean(street || locality);
  const isStandInName = Boolean(meetName) && name === meetName?.trim();
  if (!hasAddress && (!name || isStandInName)) return '';
  return [name, street, locality].filter(Boolean).join(', ');
}
