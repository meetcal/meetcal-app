import { readFileSync } from 'fs';
import { join } from 'path';
import {
  listedMeetTitle,
  MAX_WIDGET_PAGES,
  parseAddress,
  parseDateRange,
  readAllWidgetPages,
  readWidgetPage,
  transformMeets,
  WIDGET_PAGE_SIZE,
  widgetPageUrl,
} from '../../convex/scrapers/parse/meets';
import { stateCode, usTimeZone } from '../../convex/scrapers/lib/states';
import { isMeetTimeZone } from '../../convex/lib/validation';

// The WSO search's first page as the widget sent it on 2026-10-11 (contact
// details and descriptions dropped).
const WSO_PAGE: unknown = JSON.parse(readFileSync(join(__dirname, 'fixtures/sport80-meet-widget-wso-20261011.json'), 'utf8'));
// Meets abroad in the widget's shape. No meet abroad was listed when this was
// written (October 2026), so the rows are built on the widget's address
// template, "Venue, Street, City, Region, Country, Postcode", with US
// addresses whose city or state reads like a country, and the live online
// qualifier row, whose address is the country alone.
const ABROAD_PAGE: unknown = JSON.parse(readFileSync(join(__dirname, 'fixtures/sport80-meet-widget-abroad.json'), 'utf8'));

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

  it('reads a US city back from the state, whatever comes between it and the venue (#403)', () => {
    // A street first, then a suite: the suite is no city.
    expect(parseAddress('17630 Juniper Path, Suite F, Lakeville, Minnesota, United States of America, 55044')).toEqual({
      venueName: '', street: '17630 Juniper Path, Suite F', city: 'Lakeville', state: 'Minnesota', zip: '55044',
    });
    expect(parseAddress('1540 W Park Ave, #4, Titon Falls, New Jersey, United States of America, 07712')).toMatchObject({
      street: '1540 W Park Ave, #4', city: 'Titon Falls', state: 'New Jersey',
    });
    // A building between the venue and the street belongs to the venue.
    expect(parseAddress('Wayne State University, Mort Harris Fitness & Recreation Center, 5210 Gullen Mall, Detroit, Michigan, United States of America, 48202')).toEqual({
      venueName: 'Wayne State University, Mort Harris Fitness & Recreation Center', street: '5210 Gullen Mall', city: 'Detroit', state: 'Michigan', zip: '48202',
    });
    // No street at all.
    expect(parseAddress('Gym, Reno, Nevada, United States of America, 89501')).toEqual({ venueName: 'Gym', street: '', city: 'Reno', state: 'Nevada', zip: '89501' });
    // No country, but a US state before the zip.
    expect(parseAddress('12 Oak Rd, Suite 2, Reno, Nevada, 89501')).toMatchObject({ street: '12 Oak Rd, Suite 2', city: 'Reno', state: 'Nevada' });
  });

  it('takes the zone of the city the address really names in a state that spans two (#403)', () => {
    const [meet] = transformMeets([
      { name: 'Panhandle Open', address: 'Venue, Building, 123 Main St, Pensacola, Florida, United States of America, 32501', subtitle: '10/01/2026' },
    ]).meets;
    expect(meet).toMatchObject({ venueName: 'Venue, Building', venueStreet: '123 Main St', venueCity: 'Pensacola', venueState: 'FL', timeZone: 'America/Chicago' });
  });

  it('turns MM/DD/YYYY ranges (escaped slashes too) into padded ISO dates', () => {
    expect(parseDateRange('09/25/2026 - 09/27/2026')).toEqual({ startDate: '2026-09-25', endDate: '2026-09-27' });
    expect(parseDateRange('12\\/03\\/2026')).toEqual({ startDate: '2026-12-03', endDate: '2026-12-03' });
    expect(parseDateRange('9/5/2026 - 9/6/2026')).toEqual({ startDate: '2026-09-05', endDate: '2026-09-06' });
    expect(parseDateRange('9/5/2026')).toEqual({ startDate: '2026-09-05', endDate: '2026-09-05' });
  });

  it('refuses dates it cannot read rather than store made-up ones', () => {
    expect(parseDateRange('TBD')).toBeNull();
    expect(parseDateRange('')).toBeNull();
    expect(parseDateRange('10/01/2026 - TBD')).toBeNull();
    expect(parseDateRange('02/30/2026')).toBeNull();
    expect(parseDateRange('13/01/2026')).toBeNull();
    expect(parseDateRange('2026-10-01')).toBeNull();
    expect(parseDateRange('10/03/2026 - 10/01/2026')).toBeNull();
    expect(parseDateRange('10/01/2026 - 10/02/2026 - 10/03/2026')).toBeNull();
  });

  it('maps states and zones, defaults the venue to the meet name, drops adaptive meets and reports what it cannot read', () => {
    const rows = [
      { name: 'Hawaii Open', address: '1 Beach Rd, Honolulu, Hawaii, United States of America, 96815', subtitle: '10/01/2026 - 10/02/2026' },
      { name: 'Adaptive Nationals', address: 'X, 1 A St, B, Ohio, United States of America, 43004', subtitle: 'TBD' },
      { name: 'Unknown Land', address: 'Hall, 1 A St, Town, Atlantis, 00000', subtitle: '11/01/2026 - 11/01/2026' },
      { name: 'Knoxville Open', address: 'Gym, 1 Main St, Knoxville, Tennessee, United States of America, 37902', subtitle: '9/5/2026' },
      { name: 'Someday Open', address: 'Gym, 1 Main St, Nashville, Tennessee, United States of America, 37210', subtitle: 'TBD' },
      { name: 'Blank Open', address: 'Gym, 1 Main St, Nashville, Tennessee, United States of America, 37210', subtitle: ' ' },
      { name: 'Typo Open', address: 'Gym, 1 Main St, Nashville, Tennessee, United States of America, 37210', subtitle: '10/1/26' },
    ];
    expect(transformMeets(rows)).toEqual({
      meets: [
        { name: 'Hawaii Open', venueName: 'Hawaii Open', venueStreet: '1 Beach Rd', venueCity: 'Honolulu', venueState: 'HI', venueZip: '96815', timeZone: 'Pacific/Honolulu', startDate: '2026-10-01', endDate: '2026-10-02', status: 'upcoming', federation: 'USAW' },
        // No zone for a state that is not a US state: the sync keeps what is stored.
        { name: 'Unknown Land', venueName: 'Hall', venueStreet: '1 A St', venueCity: 'Town', venueState: 'Atlantis', venueZip: '00000', startDate: '2026-11-01', endDate: '2026-11-01', status: 'upcoming', federation: 'USAW' },
        { name: 'Knoxville Open', venueName: 'Gym', venueStreet: '1 Main St', venueCity: 'Knoxville', venueState: 'TN', venueZip: '37902', timeZone: 'America/New_York', startDate: '2026-09-05', endDate: '2026-09-05', status: 'upcoming', federation: 'USAW' },
      ],
      // Dates not set yet wait without failing the run; dates it cannot read fail it.
      undated: ['Someday Open', 'Blank Open'],
      rejected: ['Typo Open: unreadable dates "10/1/26"'],
      unknownZone: ['Unknown Land: state "Atlantis"'],
    });
  });

  it('reads the widget fixture', () => {
    const { total, rows } = readWidgetPage(WSO_PAGE);
    expect(total).toBe(10);
    expect(rows).toHaveLength(10);
    const { meets, rejected, unknownZone } = transformMeets(rows);
    expect(rejected).toEqual([]);
    expect(unknownZone).toEqual([]);
    expect(meets.map((m) => [m.name, m.venueCity, m.venueState, m.timeZone, m.startDate, m.endDate])).toContainEqual([
      '2026 Tennessee-Kentucky WSO Championship', 'Nashville', 'TN', 'America/Chicago', '2026-10-17', '2026-10-17',
    ]);
    expect(meets.find((m) => m.name === '2026 California North WSO Championships')).toMatchObject({ timeZone: 'America/Los_Angeles', startDate: '2026-12-03', endDate: '2026-12-06' });
  });

  it('takes the zone of a meet abroad from its country, when the country keeps one clock', () => {
    const { rows } = readWidgetPage(ABROAD_PAGE);
    const { meets, rejected, unknownZone } = transformMeets(rows);
    expect(rejected).toEqual([]);
    expect(Object.fromEntries(meets.map((m) => [m.name, m.timeZone ?? null]))).toEqual({
      '2026 October Online Qualifier (NUQ)': null,
      'Tokyo Masters Invitational': 'Asia/Tokyo',
      // Several zones: reported, not guessed.
      'Sydney Open': null,
      'Barcelona Cup': 'Europe/Madrid',
      // Spain's Canary Islands keep their own clock.
      'Tenerife Classic': 'Atlantic/Canary',
      'Kolkata International': 'Asia/Kolkata',
      'Auckland Open': 'Pacific/Auckland',
      'London Classic': 'Europe/London',
      'Mexico City Cup': null,
      // A territory listed as a US state.
      'Puerto Rico Open': 'America/Puerto_Rico',
      // A US town named like a country, and the state named like one, stay US.
      'Lebanon Valley Open': 'America/New_York',
      'Peach State Open': 'America/New_York',
    });
    expect(unknownZone).toEqual([
      '2026 October Online Qualifier (NUQ): state "Unknown"',
      'Sydney Open: Australia spans several time zones',
      'Mexico City Cup: Mexico spans several time zones',
    ]);
    expect(meets.find((m) => m.name === 'Tokyo Masters Invitational')).toMatchObject({ venueCity: 'Shibuya City', venueState: 'Japan', venueZip: '151-0051' });
  });

  it('refuses a widget response it cannot read', () => {
    expect(() => readWidgetPage(null)).toThrow('not an object');
    expect(() => readWidgetPage({ data: [] })).toThrow('no match count');
    expect(() => readWidgetPage({ total: '1' })).toThrow('no data array');
    expect(() => readWidgetPage({ total: 1, data: [{ subtitle: '10/01/2026' }] })).toThrow('row 0 has no name');
    // A missing address or date is told apart from a blank one.
    expect(readWidgetPage({ total: 1, data: [{ id: 7, name: ' A ' }] }).rows).toEqual([{ id: '7', name: 'A', address: null, subtitle: null }]);
    expect(readWidgetPage({ total: 1, data: [{ id: 7, name: 'A', address: '', subtitle: '' }] }).rows).toEqual([{ id: '7', name: 'A', address: '', subtitle: '' }]);
  });

  it('fails a meet with no dates field rather than wait for its dates', () => {
    expect(transformMeets([{ name: 'No subtitle', address: 'Gym, 1 Main St, Nashville, Tennessee, United States of America, 37210', subtitle: null }])).toEqual({
      meets: [],
      undated: [],
      rejected: ['No subtitle: no dates'],
      unknownZone: [],
    });
  });

  it('syncs a meet with no address without a venue or zone, so the stored ones stay', () => {
    const rows = [
      { name: 'No address', address: null, subtitle: '10/01/2026' },
      { name: 'Blank address', address: ' ', subtitle: '10/02/2026' },
    ];
    expect(transformMeets(rows)).toEqual({
      meets: [
        { name: 'No address', startDate: '2026-10-01', endDate: '2026-10-01', status: 'upcoming', federation: 'USAW' },
        { name: 'Blank address', startDate: '2026-10-02', endDate: '2026-10-02', status: 'upcoming', federation: 'USAW' },
      ],
      undated: [],
      rejected: [],
      unknownZone: ['No address: no address', 'Blank address: no address'],
    });
  });

  it('asks for each page of a search, or of the whole listing', () => {
    expect(widgetPageUrl('Virus Weightlifting', 2)).toBe(
      `https://usaweightlifting.sport80.com/api/public/widget/data/new/1?p=2&i=${WIDGET_PAGE_SIZE}&l=&d=10&f=&s=Virus%20Weightlifting`,
    );
    expect(widgetPageUrl('', 0)).toBe(`https://usaweightlifting.sport80.com/api/public/widget/data/new/1?p=0&i=${WIDGET_PAGE_SIZE}&l=&d=10&f=&s=`);
  });

  it('lists WSO, national and Virus series meets by title (#413)', () => {
    for (const title of [
      '2026 Georgia WSO Championships',
      'Sadecki MN State Championships and Mn/Dak WSO 3',
      '2027 USA Weightlifting National Championships & Virus Weightlifting Series 1',
      '2026 Masters National Championships & National University Championships',
      'Spring Nationals Qualifier',
      '2026 VIRUS Weightlifting Series 1',
      '2026 Florida State Championships (WSO Championships)',
    ]) {
      expect([title, listedMeetTitle(title)]).toEqual([title, true]);
    }
    for (const title of ['2026 New Jersey State Championship (NUQ)', 'Kolkata International', 'Halloweenie', 'NJWSOpen']) {
      expect([title, listedMeetTitle(title)]).toEqual([title, false]);
    }
  });

  it("keeps each meet's Sport80 event id", () => {
    const { meets } = transformMeets([
      { id: '14836', name: 'NJ', address: '1540 W Park Ave, #4, Titon Falls, New Jersey, United States of America, 07712', subtitle: '10/24/2026 - 10/25/2026' },
      { id: '15078', name: 'No address', address: null, subtitle: '03/14/2027' },
      { id: null, name: 'No id', address: null, subtitle: '03/14/2027' },
    ]);
    expect(meets.map((m) => [m.name, m.sourceId])).toEqual([
      ['NJ', '14836'],
      ['No address', '15078'],
      ['No id', undefined],
    ]);
  });

  describe('paging', () => {
    const meet = (i: number) => ({ id: String(i), name: `Meet ${i}`, address: '', subtitle: '10/01/2026' });
    /** A widget with `total` meets, served `WIDGET_PAGE_SIZE` at a time. */
    const widget = (total: number, count = total) => {
      const pages: number[] = [];
      const fetchPage = async (page: number) => {
        pages.push(page);
        const ids = Array.from({ length: count }, (_, i) => i).slice(page * WIDGET_PAGE_SIZE, (page + 1) * WIDGET_PAGE_SIZE);
        return { total: String(total), data: ids.map(meet) };
      };
      return { pages, fetchPage };
    };

    it('reads one page when the search fits on it', async () => {
      const { pages, fetchPage } = widget(10);
      expect(await readAllWidgetPages(fetchPage)).toHaveLength(10);
      expect(pages).toEqual([0]);
    });

    it('reads every page of a search past the first 20', async () => {
      const { pages, fetchPage } = widget(45);
      const rows = await readAllWidgetPages(fetchPage);
      expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 45 }, (_, i) => String(i)));
      expect(pages).toEqual([0, 1, 2]);
    });

    it('stops at an empty page and fails when it read fewer meets than the count', async () => {
      const { pages, fetchPage } = widget(45, 40);
      await expect(readAllWidgetPages(fetchPage)).rejects.toThrow('read 40 distinct meets of 45');
      expect(pages).toEqual([0, 1, 2]);
    });

    it('fails rather than drop meets past the page cap', async () => {
      const { pages, fetchPage } = widget(MAX_WIDGET_PAGES * WIDGET_PAGE_SIZE + 1);
      await expect(readAllWidgetPages(fetchPage)).rejects.toThrow(`of ${MAX_WIDGET_PAGES * WIDGET_PAGE_SIZE + 1}`);
      expect(pages).toHaveLength(MAX_WIDGET_PAGES);
    });

    it('fails when pages repeat meets', async () => {
      const fetchPage = async (page: number) => ({ total: 25, data: Array.from({ length: page === 0 ? 20 : 5 }, (_, i) => meet(i)) });
      await expect(readAllWidgetPages(fetchPage)).rejects.toThrow('read 20 distinct meets of 25');
    });

    it('keeps a meet once when the listing shifts between pages', async () => {
      // Page 0 has meets 1-20; by page 1 the listing moved, so it has 16-25.
      const fetchPage = async (page: number) => ({ total: 25, data: Array.from({ length: page === 0 ? 20 : 10 }, (_, i) => meet(page === 0 ? i + 1 : i + 16)) });
      const rows = await readAllWidgetPages(fetchPage);
      expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 25 }, (_, i) => String(i + 1)));
    });
  });
});

describe('US states and time zones', () => {
  it('knows states by name or code', () => {
    expect(stateCode('Tennessee')).toBe('TN');
    expect(stateCode(' new  york ')).toBe('NY');
    expect(stateCode('tx')).toBe('TX');
    expect(stateCode('Unknown')).toBeNull();
    expect(stateCode('Japan')).toBeNull();
  });

  it('gives the main zone, and the other zone for towns across a state line', () => {
    expect(usTimeZone('Tennessee', 'Nashville')).toBe('America/Chicago');
    expect(usTimeZone('Tennessee', 'Knoxville')).toBe('America/New_York');
    expect(usTimeZone('TN', 'CHATTANOOGA')).toBe('America/New_York');
    expect(usTimeZone('Florida', 'Tampa')).toBe('America/New_York');
    expect(usTimeZone('Florida', 'Pensacola')).toBe('America/Chicago');
    expect(usTimeZone('Texas', 'Austin')).toBe('America/Chicago');
    expect(usTimeZone('Texas', 'El Paso')).toBe('America/Denver');
    expect(usTimeZone('Kentucky', 'Louisville')).toBe('America/New_York');
    expect(usTimeZone('Kentucky', 'Bowling Green')).toBe('America/Chicago');
    expect(usTimeZone('Idaho', 'Boise')).toBe('America/Denver');
    expect(usTimeZone('Idaho', "Coeur d'Alene")).toBe('America/Los_Angeles');
    expect(usTimeZone('Indiana', 'Indianapolis')).toBe('America/New_York');
    expect(usTimeZone('Indiana', 'Evansville')).toBe('America/Chicago');
    expect(usTimeZone('Arizona')).toBe('America/Phoenix');
    expect(usTimeZone('Atlantis', 'Town')).toBeNull();
    expect(usTimeZone('')).toBeNull();
  });

  it('only names IANA zones', () => {
    for (const state of ['AL', 'AK', 'AZ', 'CA', 'FL', 'HI', 'ID', 'IN', 'KS', 'KY', 'MI', 'NE', 'ND', 'OR', 'SD', 'TN', 'TX']) {
      expect(isMeetTimeZone(usTimeZone(state) ?? '')).toBe(true);
    }
  });
});
