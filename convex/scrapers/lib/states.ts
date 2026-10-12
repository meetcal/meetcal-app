// US states for the meet scrapers: each state's postal code and time zone,
// shared by the Sport80 meet sync (`parse/meets.ts`) and the USA Masters
// events (`parse/usamwEvents.ts`).
//
// Zones are the seven the app knows (`src/data/types/meet.ts`); a zone outside
// them is shown in New York time. A state that spans two zones has its main
// zone here and the towns on the other side of the line in `OTHER_ZONE_CITIES`.

const EASTERN = 'America/New_York';
const CENTRAL = 'America/Chicago';
const MOUNTAIN = 'America/Denver';
const ARIZONA = 'America/Phoenix';
const PACIFIC = 'America/Los_Angeles';
const ALASKA = 'America/Anchorage';
const HAWAII = 'Pacific/Honolulu';

/** State name -> [postal code, main time zone]. */
const STATES: Record<string, [code: string, zone: string]> = {
  Alabama: ['AL', CENTRAL], Alaska: ['AK', ALASKA], Arizona: ['AZ', ARIZONA], Arkansas: ['AR', CENTRAL],
  California: ['CA', PACIFIC], Colorado: ['CO', MOUNTAIN], Connecticut: ['CT', EASTERN], Delaware: ['DE', EASTERN],
  Florida: ['FL', EASTERN], Georgia: ['GA', EASTERN], Hawaii: ['HI', HAWAII], Idaho: ['ID', MOUNTAIN],
  Illinois: ['IL', CENTRAL], Indiana: ['IN', EASTERN], Iowa: ['IA', CENTRAL], Kansas: ['KS', CENTRAL],
  Kentucky: ['KY', EASTERN], Louisiana: ['LA', CENTRAL], Maine: ['ME', EASTERN], Maryland: ['MD', EASTERN],
  Massachusetts: ['MA', EASTERN], Michigan: ['MI', EASTERN], Minnesota: ['MN', CENTRAL], Mississippi: ['MS', CENTRAL],
  Missouri: ['MO', CENTRAL], Montana: ['MT', MOUNTAIN], Nebraska: ['NE', CENTRAL], Nevada: ['NV', PACIFIC],
  'New Hampshire': ['NH', EASTERN], 'New Jersey': ['NJ', EASTERN], 'New Mexico': ['NM', MOUNTAIN], 'New York': ['NY', EASTERN],
  'North Carolina': ['NC', EASTERN], 'North Dakota': ['ND', CENTRAL], Ohio: ['OH', EASTERN], Oklahoma: ['OK', CENTRAL],
  Oregon: ['OR', PACIFIC], Pennsylvania: ['PA', EASTERN], 'Rhode Island': ['RI', EASTERN], 'South Carolina': ['SC', EASTERN],
  'South Dakota': ['SD', CENTRAL], Tennessee: ['TN', CENTRAL], Texas: ['TX', CENTRAL], Utah: ['UT', MOUNTAIN],
  Vermont: ['VT', EASTERN], Virginia: ['VA', EASTERN], Washington: ['WA', PACIFIC], 'West Virginia': ['WV', EASTERN],
  Wisconsin: ['WI', CENTRAL], Wyoming: ['WY', MOUNTAIN], 'District of Columbia': ['DC', EASTERN],
};

/**
 * Towns in a split state that keep the other zone, by state code. Not every
 * town: the ones meets are likely to be held in. A meet elsewhere on that
 * side of the line gets the state's main zone; set it by hand with
 * `ingest:setMeetTimeZone`, which the syncs then leave alone.
 */
const OTHER_ZONE_CITIES: Record<string, [zone: string, cities: string[]]> = {
  // East Tennessee.
  TN: [EASTERN, ['knoxville', 'chattanooga', 'johnson city', 'kingsport', 'bristol', 'cleveland', 'maryville', 'alcoa', 'oak ridge', 'morristown', 'sevierville', 'pigeon forge', 'gatlinburg', 'athens', 'greeneville', 'elizabethton', 'farragut', 'lenoir city', 'collegedale', 'ooltewah', 'hixson', 'signal mountain', 'red bank', 'east ridge', 'soddy-daisy', 'soddy daisy', 'powell', 'clinton', 'jefferson city', 'newport', 'rogersville', 'harriman', 'kingston', 'loudon', 'dayton']],
  // The panhandle west of the Apalachicola River.
  FL: [CENTRAL, ['pensacola', 'panama city', 'panama city beach', 'lynn haven', 'callaway', 'mexico beach', 'fort walton beach', 'destin', 'navarre', 'crestview', 'niceville', 'valparaiso', 'mary esther', 'shalimar', 'milton', 'pace', 'gulf breeze', 'defuniak springs', 'freeport', 'santa rosa beach', 'miramar beach', 'marianna', 'chipley', 'bonifay']],
  // El Paso and Hudspeth and Culberson counties.
  TX: [MOUNTAIN, ['el paso', 'socorro', 'horizon city', 'canutillo', 'anthony', 'clint', 'fabens', 'san elizario', 'vinton', 'sierra blanca', 'van horn']],
  // Western Kentucky.
  KY: [CENTRAL, ['bowling green', 'owensboro', 'paducah', 'hopkinsville', 'henderson', 'madisonville', 'murray', 'mayfield', 'glasgow', 'franklin', 'russellville', 'princeton', 'central city', 'greenville', 'scottsville', 'tompkinsville', 'leitchfield', 'morgantown', 'cadiz', 'benton', 'calvert city', 'fort campbell', 'oak grove', 'beaver dam', 'hartford', 'columbia']],
  // North Idaho.
  ID: [PACIFIC, ["coeur d'alene", 'coeur d alene', 'post falls', 'hayden', 'rathdrum', 'sandpoint', 'moscow', 'lewiston', 'bonners ferry', 'kellogg', 'wallace', 'grangeville', 'orofino', 'priest river', 'spirit lake']],
  // The Chicago suburbs of the northwest and the Evansville corner of the southwest.
  IN: [CENTRAL, ['gary', 'hammond', 'east chicago', 'merrillville', 'crown point', 'valparaiso', 'portage', 'michigan city', 'la porte', 'laporte', 'munster', 'highland', 'schererville', 'hobart', 'dyer', 'st. john', 'saint john', 'cedar lake', 'lowell', 'chesterton', 'griffith', 'lake station', 'evansville', 'newburgh', 'mount vernon', 'princeton', 'boonville', 'tell city']],
  // The Upper Peninsula's Wisconsin border counties.
  MI: [CENTRAL, ['menominee', 'iron mountain', 'kingsford', 'norway', 'ironwood', 'bessemer', 'wakefield', 'iron river']],
  KS: [MOUNTAIN, ['goodland', 'sharon springs', 'tribune', 'syracuse']],
  NE: [MOUNTAIN, ['scottsbluff', 'gering', 'alliance', 'sidney', 'chadron', 'ogallala', 'kimball', 'mitchell', 'bridgeport']],
  ND: [MOUNTAIN, ['dickinson', 'beach', 'bowman', 'mott', 'hettinger', 'belfield', 'medora']],
  SD: [MOUNTAIN, ['rapid city', 'spearfish', 'sturgis', 'belle fourche', 'lead', 'deadwood', 'custer', 'hot springs', 'box elder', 'hill city', 'wall']],
  // Malheur County.
  OR: [MOUNTAIN, ['ontario', 'nyssa', 'vale']],
};

const BY_CODE = new Map(Object.values(STATES).map(([code, zone]) => [code, zone]));
const BY_NAME = new Map(Object.entries(STATES).map(([name, entry]) => [name.toLowerCase(), entry]));
const OTHER_ZONE = new Map(Object.entries(OTHER_ZONE_CITIES).map(([code, [zone, cities]]) => [code, { zone, cities: new Set(cities) }]));

const fold = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** The postal code of a US state given by name ("Tennessee") or code ("tn"), or null. */
export function stateCode(state: string): string | null {
  const folded = fold(state);
  const code = folded.toUpperCase();
  if (BY_CODE.has(code)) return code;
  return BY_NAME.get(folded)?.[0] ?? null;
}

/**
 * The IANA zone of a meet in `city`, `state` (name or code): the state's main
 * zone unless the city is one listed on the other side of a zone line. Null
 * for a state that is not a US state (or not given): the caller reports it
 * rather than guess.
 */
export function usTimeZone(state: string, city = ''): string | null {
  const code = stateCode(state);
  if (code === null) return null;
  const other = OTHER_ZONE.get(code);
  if (other?.cities.has(fold(city))) return other.zone;
  return BY_CODE.get(code)!;
}
