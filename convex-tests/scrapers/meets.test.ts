import { readFileSync } from 'fs';
import { join } from 'path';
import {
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

// The WSO search's first page as the widget sent it on 2026-10-11 (contact
// details and descriptions dropped).
const WSO_PAGE: unknown = JSON.parse(readFileSync(join(__dirname, 'fixtures/sport80-meet-widget-wso-20261011.json'), 'utf8'));

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

  it('refuses a widget response it cannot read', () => {
    expect(() => readWidgetPage(null)).toThrow('not an object');
    expect(() => readWidgetPage({ data: [] })).toThrow('no match count');
    expect(() => readWidgetPage({ total: '1' })).toThrow('no data array');
    expect(() => readWidgetPage({ total: 1, data: [{ subtitle: '10/01/2026' }] })).toThrow('row 0 has no name');
    expect(readWidgetPage({ total: 1, data: [{ id: 7, name: ' A ' }] }).rows).toEqual([{ id: '7', name: 'A', address: '', subtitle: '' }]);
  });

  it('asks for each page of a search', () => {
    expect(widgetPageUrl('Virus Weightlifting', 2)).toBe(
      `https://usaweightlifting.sport80.com/api/public/widget/data/new/1?p=2&i=${WIDGET_PAGE_SIZE}&l=&d=10&f=&s=Virus%20Weightlifting`,
    );
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

  it('only names zones the app knows', () => {
    const known = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
    for (const state of ['AL', 'AK', 'AZ', 'CA', 'FL', 'HI', 'ID', 'IN', 'KS', 'KY', 'MI', 'NE', 'ND', 'OR', 'SD', 'TN', 'TX']) {
      expect(known).toContain(usTimeZone(state));
    }
  });
});
