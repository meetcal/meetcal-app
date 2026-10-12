// Countries and US territories for the meet scrapers: the IANA zone of a
// meet held outside the 50 states, when its country tells it. Shared by the
// Sport80 meet sync (`parse/meets.ts`) and the USA Masters events
// (`parse/usamwEvents.ts`); the states are in `states.ts`.
//
// Only a country that keeps one clock everywhere gets a zone, taken from the
// tz database's `zone.tab`. A few keep one clock except on outlying islands,
// listed with the islands' places. A country that spans several zones (Canada,
// Mexico, Australia, ...) gets none: the meet is reported and its zone is set
// by hand with `ingest:setMeetTimeZone`. Georgia is left out: the name is read
// as the US state first.

/** US territories (not in `states.ts`) -> zone. */
const US_TERRITORIES: Record<string, string> = {
  'puerto rico': 'America/Puerto_Rico', guam: 'Pacific/Guam', 'american samoa': 'Pacific/Pago_Pago',
  'samoa (american)': 'Pacific/Pago_Pago', 'northern mariana islands': 'Pacific/Saipan',
  'us virgin islands': 'America/St_Thomas', 'u.s. virgin islands': 'America/St_Thomas', 'virgin islands (us)': 'America/St_Thomas',
};

/** Country name (and common spellings) -> its one zone. */
const ONE_ZONE: Record<string, string> = {
  ...US_TERRITORIES,
  // Americas and the Caribbean.
  'antigua and barbuda': 'America/Antigua', 'antigua & barbuda': 'America/Antigua', aruba: 'America/Aruba',
  argentina: 'America/Argentina/Buenos_Aires', bahamas: 'America/Nassau', 'the bahamas': 'America/Nassau',
  barbados: 'America/Barbados', belize: 'America/Belize', bermuda: 'Atlantic/Bermuda', bolivia: 'America/La_Paz',
  'british virgin islands': 'America/Tortola', 'cayman islands': 'America/Cayman', colombia: 'America/Bogota',
  'costa rica': 'America/Costa_Rica', cuba: 'America/Havana', curacao: 'America/Curacao', dominica: 'America/Dominica',
  'dominican republic': 'America/Santo_Domingo', 'el salvador': 'America/El_Salvador', grenada: 'America/Grenada',
  guatemala: 'America/Guatemala', guyana: 'America/Guyana', haiti: 'America/Port-au-Prince',
  honduras: 'America/Tegucigalpa', jamaica: 'America/Jamaica', nicaragua: 'America/Managua', panama: 'America/Panama',
  paraguay: 'America/Asuncion', peru: 'America/Lima', 'saint lucia': 'America/St_Lucia', 'st lucia': 'America/St_Lucia',
  suriname: 'America/Paramaribo', 'trinidad and tobago': 'America/Port_of_Spain', 'trinidad & tobago': 'America/Port_of_Spain',
  uruguay: 'America/Montevideo', venezuela: 'America/Caracas',
  // Europe.
  albania: 'Europe/Tirane', andorra: 'Europe/Andorra', armenia: 'Asia/Yerevan', austria: 'Europe/Vienna',
  azerbaijan: 'Asia/Baku', belarus: 'Europe/Minsk', belgium: 'Europe/Brussels', 'bosnia and herzegovina': 'Europe/Sarajevo',
  'bosnia & herzegovina': 'Europe/Sarajevo', bulgaria: 'Europe/Sofia', croatia: 'Europe/Zagreb', cyprus: 'Asia/Nicosia',
  czechia: 'Europe/Prague', 'czech republic': 'Europe/Prague', denmark: 'Europe/Copenhagen', estonia: 'Europe/Tallinn',
  finland: 'Europe/Helsinki', france: 'Europe/Paris', germany: 'Europe/Berlin', gibraltar: 'Europe/Gibraltar',
  greece: 'Europe/Athens', hungary: 'Europe/Budapest', iceland: 'Atlantic/Reykjavik', ireland: 'Europe/Dublin',
  italy: 'Europe/Rome', latvia: 'Europe/Riga', liechtenstein: 'Europe/Vaduz', lithuania: 'Europe/Vilnius',
  luxembourg: 'Europe/Luxembourg', malta: 'Europe/Malta', moldova: 'Europe/Chisinau', monaco: 'Europe/Monaco',
  montenegro: 'Europe/Podgorica', netherlands: 'Europe/Amsterdam', 'the netherlands': 'Europe/Amsterdam',
  'north macedonia': 'Europe/Skopje', norway: 'Europe/Oslo', poland: 'Europe/Warsaw', romania: 'Europe/Bucharest',
  'san marino': 'Europe/San_Marino', serbia: 'Europe/Belgrade', slovakia: 'Europe/Bratislava', slovenia: 'Europe/Ljubljana',
  sweden: 'Europe/Stockholm', switzerland: 'Europe/Zurich', turkey: 'Europe/Istanbul', turkiye: 'Europe/Istanbul',
  'united kingdom': 'Europe/London', uk: 'Europe/London', 'great britain': 'Europe/London', 'britain (uk)': 'Europe/London',
  england: 'Europe/London', scotland: 'Europe/London', wales: 'Europe/London', 'northern ireland': 'Europe/London',
  // Asia and the Middle East. China keeps Beijing time everywhere officially
  // (the tz database's Asia/Urumqi is Xinjiang's unofficial local time).
  afghanistan: 'Asia/Kabul', bahrain: 'Asia/Bahrain', bangladesh: 'Asia/Dhaka', bhutan: 'Asia/Thimphu',
  brunei: 'Asia/Brunei', cambodia: 'Asia/Phnom_Penh', china: 'Asia/Shanghai', "people's republic of china": 'Asia/Shanghai',
  'hong kong': 'Asia/Hong_Kong', india: 'Asia/Kolkata', iran: 'Asia/Tehran', iraq: 'Asia/Baghdad', israel: 'Asia/Jerusalem',
  japan: 'Asia/Tokyo', jordan: 'Asia/Amman', kuwait: 'Asia/Kuwait', kyrgyzstan: 'Asia/Bishkek', laos: 'Asia/Vientiane',
  lebanon: 'Asia/Beirut', macau: 'Asia/Macau', macao: 'Asia/Macau', malaysia: 'Asia/Kuala_Lumpur', maldives: 'Indian/Maldives',
  myanmar: 'Asia/Yangon', nepal: 'Asia/Kathmandu', oman: 'Asia/Muscat', pakistan: 'Asia/Karachi', philippines: 'Asia/Manila',
  qatar: 'Asia/Qatar', 'saudi arabia': 'Asia/Riyadh', singapore: 'Asia/Singapore', 'south korea': 'Asia/Seoul',
  korea: 'Asia/Seoul', 'republic of korea': 'Asia/Seoul', 'korea (south)': 'Asia/Seoul',
  'sri lanka': 'Asia/Colombo', syria: 'Asia/Damascus', taiwan: 'Asia/Taipei', 'chinese taipei': 'Asia/Taipei',
  tajikistan: 'Asia/Dushanbe', thailand: 'Asia/Bangkok', turkmenistan: 'Asia/Ashgabat',
  'united arab emirates': 'Asia/Dubai', uae: 'Asia/Dubai', uzbekistan: 'Asia/Tashkent', vietnam: 'Asia/Ho_Chi_Minh',
  'viet nam': 'Asia/Ho_Chi_Minh',
  // Africa.
  algeria: 'Africa/Algiers', botswana: 'Africa/Gaborone', cameroon: 'Africa/Douala', "cote d'ivoire": 'Africa/Abidjan',
  'ivory coast': 'Africa/Abidjan', egypt: 'Africa/Cairo', ethiopia: 'Africa/Addis_Ababa', ghana: 'Africa/Accra',
  kenya: 'Africa/Nairobi', libya: 'Africa/Tripoli', madagascar: 'Indian/Antananarivo', mauritius: 'Indian/Mauritius',
  morocco: 'Africa/Casablanca', namibia: 'Africa/Windhoek', nigeria: 'Africa/Lagos', rwanda: 'Africa/Kigali',
  senegal: 'Africa/Dakar', 'south africa': 'Africa/Johannesburg', tanzania: 'Africa/Dar_es_Salaam', tunisia: 'Africa/Tunis',
  uganda: 'Africa/Kampala', zambia: 'Africa/Lusaka', zimbabwe: 'Africa/Harare',
  // Oceania.
  fiji: 'Pacific/Fiji', 'marshall islands': 'Pacific/Majuro', nauru: 'Pacific/Nauru', 'new caledonia': 'Pacific/Noumea',
  palau: 'Pacific/Palau', samoa: 'Pacific/Apia', 'solomon islands': 'Pacific/Guadalcanal', tonga: 'Pacific/Tongatapu',
  tuvalu: 'Pacific/Funafuti', vanuatu: 'Pacific/Efate',
};

/**
 * Countries on one clock except for outlying islands: the mainland zone, and
 * each island zone with the places that name it, matched as whole words in the
 * city and region the caller passes (never the street: Madrid has a Calle de
 * la Palma). The islands' provinces and largest islands are named, not every
 * town, because an island address gives its province or region.
 */
const MAINLAND_ZONE: Record<string, [zone: string, islands: [zone: string, places: string[]][]]> = {
  spain: ['Europe/Madrid', [['Atlantic/Canary', ['canary islands', 'canarias', 'islas canarias', 'tenerife', 'gran canaria', 'las palmas', 'lanzarote', 'fuerteventura']]]],
  portugal: ['Europe/Lisbon', [['Atlantic/Azores', ['azores', 'acores', 'ponta delgada', 'sao miguel', 'angra do heroismo']]]],
  'new zealand': ['Pacific/Auckland', [['Pacific/Chatham', ['chatham islands', 'chatham island']]]],
  ecuador: ['America/Guayaquil', [['Pacific/Galapagos', ['galapagos', 'puerto ayora', 'puerto baquerizo moreno', 'santa cruz island']]]],
};

/** Countries whose clocks differ from place to place: never guessed. */
const SEVERAL_ZONES = new Set([
  'australia', 'brazil', 'canada', 'chile', 'democratic republic of the congo', 'congo (dem. rep.)', 'french polynesia',
  'greenland', 'indonesia', 'kazakhstan', 'kiribati', 'mexico', 'micronesia', 'mongolia', 'papua new guinea', 'russia',
  'russian federation', 'ukraine', 'palestine', 'antarctica',
]);

const TERRITORY = new Map(Object.entries(US_TERRITORIES));
const ONE = new Map(Object.entries(ONE_ZONE));
const MAINLAND = new Map(Object.entries(MAINLAND_ZONE));

const US_NAMES = new Set(['united states of america', 'united states', 'usa', 'u.s.a.', 'us', 'u.s.']);

/** Lower case, accents dropped ("Türkiye", "Curaçao", "Açores"), one kind of apostrophe, spaces folded. */
const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘]/g, "'").trim().replace(/\s+/g, ' ').toLowerCase();

/** Whether `name` is the United States ("United States of America", "USA"). */
export function isUnitedStates(name: string): boolean {
  return US_NAMES.has(fold(name));
}

/**
 * The zone of a country on one clock everywhere (islands included), or null:
 * what a stored meet's country alone can confirm.
 */
export function oneClockCountryZone(name: string): string | null {
  return ONE.get(fold(name)) ?? null;
}

/** The zone of a US territory given as a meet's state ("Puerto Rico", "Guam"), or null. */
export function usTerritoryTimeZone(state: string): string | null {
  return TERRITORY.get(fold(state)) ?? null;
}

/**
 * The first of `names` (in order) that is a country or US territory these
 * tables know, as written, with its zone: null when it spans several zones.
 * `location` is the meet's city and region, read for outlying islands. Null
 * when none of `names` is a country they know.
 */
export function countryTimeZone(names: string[], location = ''): { country: string; zone: string | null } | null {
  for (const name of names) {
    const folded = fold(name);
    const country = name.trim();
    const one = ONE.get(folded);
    if (one !== undefined) return { country, zone: one };
    if (SEVERAL_ZONES.has(folded)) return { country, zone: null };
    const mainlandZone = MAINLAND.get(folded);
    if (mainlandZone === undefined) continue;
    const [mainland, islands] = mainlandZone;
    const place = ` ${fold(location).replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ')} `;
    const island = islands.find(([, places]) => places.some((p) => place.includes(` ${p} `)));
    return { country, zone: island ? island[0] : mainland };
  }
  return null;
}

/** Every zone these tables can give, for the test that the runtime knows each. */
export const COUNTRY_ZONES: readonly string[] = [
  ...new Set([...ONE.values(), ...[...MAINLAND.values()].flatMap(([zone, islands]) => [zone, ...islands.map(([z]) => z)])]),
];
