// Pure parts of `scrapers/meets.ts` (port of `usaw/meet_to_supabase/scripts/sync-*.js`).

const WIDGET = 'https://usaweightlifting.sport80.com/api/public/widget/data/new/1?p=0&i=20&l=&d=10&f=&s=';

/** The three searches the VPS ran; only the WSO one skips completed meets. */
export const MEET_SEARCHES = [
  { key: 'wso', url: `${WIDGET}WSO`, skipCompleted: true },
  { key: 'nationals', url: `${WIDGET}Nationals`, skipCompleted: false },
  { key: 'virus', url: `${WIDGET}Virus%20Weightlifting`, skipCompleted: false },
] as const;

export type ScrapedMeet = {
  name: string;
  venueName: string;
  venueStreet: string;
  venueCity: string;
  venueState: string;
  venueZip: string;
  timeZone: string;
  startDate: string;
  endDate: string;
  status: 'upcoming';
  federation: 'USAW';
};

type Address = { venueName: string; street: string; city: string; state: string; zip: string };

/** `parseAddress`: "Venue, Street, [Suite], City, State, Zip, United States of America". */
export function parseAddress(raw: string): Address {
  try {
    const address = raw.replace(/,\s*,/g, ',');
    const parts = address.split(', ');
    if (parts.length < 4) return { venueName: '', street: address, city: 'Unknown', state: 'Unknown', zip: 'Unknown' };
    const zip = parts[parts.length - 1];
    const stateIndex = parts.findIndex((part) => part === 'United States of America');
    const state = stateIndex > 0 ? parts[stateIndex - 1] : parts[parts.length - 2];
    let venueName = '';
    let street = '';
    let city = '';
    if (!/^\d/.test(parts[0])) {
      venueName = parts[0];
      if (parts.length >= 6) {
        street = parts[1];
        if (/Suite|Unit|Apt|#/i.test(parts[2])) {
          street += `, ${parts[2]}`;
          city = parts[3];
        } else {
          city = parts[2];
        }
      } else {
        street = parts[1];
        city = parts[2];
      }
    } else {
      street = parts[0];
      city = parts[1];
    }
    return { venueName, street, city, state, zip };
  } catch {
    return { venueName: '', street: raw, city: 'Unknown', state: 'Unknown', zip: 'Unknown' };
  }
}

/** `parseDateRange`: "MM/DD/YYYY - MM/DD/YYYY" (escaped slashes allowed) to ISO dates. */
export function parseDateRange(range: string): { startDate: string | null; endDate: string | null } {
  try {
    const dates = range.replace(/\\\//g, '/').split(' - ');
    const start = dates[0].split('/');
    const end = dates[1] ? dates[1].split('/') : start;
    return { startDate: `${start[2]}-${start[0]}-${start[1]}`, endDate: `${end[2]}-${end[0]}-${end[1]}` };
  } catch {
    return { startDate: null, endDate: null };
  }
}

const STATES: Record<string, [string, string]> = {
  Alabama: ['AL', 'America/Chicago'], Alaska: ['AK', 'America/Anchorage'], Arizona: ['AZ', 'America/Phoenix'],
  Arkansas: ['AR', 'America/Chicago'], California: ['CA', 'America/Los_Angeles'], Colorado: ['CO', 'America/Denver'],
  Connecticut: ['CT', 'America/New_York'], Delaware: ['DE', 'America/New_York'], Florida: ['FL', 'America/New_York'],
  Georgia: ['GA', 'America/New_York'], Hawaii: ['HI', 'Pacific/Honolulu'], Idaho: ['ID', 'America/Denver'],
  Illinois: ['IL', 'America/Chicago'], Indiana: ['IN', 'America/New_York'], Iowa: ['IA', 'America/Chicago'],
  Kansas: ['KS', 'America/Chicago'], Kentucky: ['KY', 'America/New_York'], Louisiana: ['LA', 'America/Chicago'],
  Maine: ['ME', 'America/New_York'], Maryland: ['MD', 'America/New_York'], Massachusetts: ['MA', 'America/New_York'],
  Michigan: ['MI', 'America/New_York'], Minnesota: ['MN', 'America/Chicago'], Mississippi: ['MS', 'America/Chicago'],
  Missouri: ['MO', 'America/Chicago'], Montana: ['MT', 'America/Denver'], Nebraska: ['NE', 'America/Chicago'],
  Nevada: ['NV', 'America/Los_Angeles'], 'New Hampshire': ['NH', 'America/New_York'], 'New Jersey': ['NJ', 'America/New_York'],
  'New Mexico': ['NM', 'America/Denver'], 'New York': ['NY', 'America/New_York'], 'North Carolina': ['NC', 'America/New_York'],
  'North Dakota': ['ND', 'America/Chicago'], Ohio: ['OH', 'America/New_York'], Oklahoma: ['OK', 'America/Chicago'],
  Oregon: ['OR', 'America/Los_Angeles'], Pennsylvania: ['PA', 'America/New_York'], 'Rhode Island': ['RI', 'America/New_York'],
  'South Carolina': ['SC', 'America/New_York'], 'South Dakota': ['SD', 'America/Chicago'], Tennessee: ['TN', 'America/Chicago'],
  Texas: ['TX', 'America/Chicago'], Utah: ['UT', 'America/Denver'], Vermont: ['VT', 'America/New_York'],
  Virginia: ['VA', 'America/New_York'], Washington: ['WA', 'America/Los_Angeles'], 'West Virginia': ['WV', 'America/New_York'],
  Wisconsin: ['WI', 'America/Chicago'], Wyoming: ['WY', 'America/Denver'], 'District of Columbia': ['DC', 'America/New_York'],
};

/** `transformMeetsData`: widget rows to meets, dropping undated and adaptive ones. */
export function transformMeets(rows: { name: string; address: string; subtitle: string }[]): ScrapedMeet[] {
  const meets: ScrapedMeet[] = [];
  for (const row of rows) {
    const { venueName, street, city, state, zip } = parseAddress(row.address);
    const { startDate, endDate } = parseDateRange(row.subtitle);
    if (!startDate || !endDate || row.name.toUpperCase().includes('ADAPTIVE')) continue;
    meets.push({
      name: row.name,
      venueName: venueName || row.name,
      venueStreet: street,
      venueCity: city,
      venueState: STATES[state]?.[0] ?? state,
      venueZip: zip,
      timeZone: STATES[state]?.[1] ?? 'America/New_York',
      startDate,
      endDate,
      status: 'upcoming',
      federation: 'USAW',
    });
  }
  return meets;
}
