import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gvizCsvByGid, gvizCsvFirstTab, resolveTabs, sheetHtmlViewUrl, sheetTabList } from '../../convex/scrapers/parse/wso/common';
import { NEW_JERSEY_TABS } from '../../convex/scrapers/parse/wso/newJersey';
import { OHIO_TAB_GIDS, OHIO_TABS } from '../../convex/scrapers/parse/wso/ohio';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('WSO sheet tabs', () => {
  it('fetches tabs by gid, never by name', () => {
    expect(gvizCsvByGid('abc', '0')).toBe('https://docs.google.com/spreadsheets/d/abc/gviz/tq?tqx=out:csv&gid=0');
    expect(gvizCsvByGid('abc', '7', 1)).toBe('https://docs.google.com/spreadsheets/d/abc/gviz/tq?tqx=out:csv&headers=1&gid=7');
    expect(gvizCsvFirstTab('abc')).toBe('https://docs.google.com/spreadsheets/d/abc/gviz/tq?tqx=out:csv');
    expect(sheetHtmlViewUrl('abc')).toBe('https://docs.google.com/spreadsheets/d/abc/htmlview');
  });

  it('knows a distinct gid for every Ohio tab', () => {
    const gids = OHIO_TABS.map((tab) => OHIO_TAB_GIDS[tab]);
    expect(gids.every((gid) => /^\d+$/.test(gid))).toBe(true);
    expect(new Set(gids).size).toBe(OHIO_TABS.length);
  });

  it("reads the visible tabs from a sheet's HTML view, names unescaped", () => {
    const tabs = sheetTabList(fixture('sheet-tabs-tennessee-kentucky-20261012.html'));
    expect(tabs).toHaveLength(22);
    expect(tabs[0]).toEqual({ name: 'TN-KY WSO Records through May 31, 2025', gid: '526394508' });
    expect(tabs[1]).toEqual({ name: '6/1/25-8/1/26 Youth Men <13', gid: '872034262' });
    // The hidden tab the source used to read is not listed.
    expect(tabs.some((tab) => tab.gid === '867133960')).toBe(false);
    expect(sheetTabList('<html>no tabs</html>')).toEqual([]);
  });

  it('resolves tabs by name (case and spacing aside) and checks gids are visible', () => {
    const list = sheetTabList(fixture('sheet-tabs-california-north-20261012.html'));
    expect(resolveTabs(list, [{ name: 'Post-Aug2026' }, { name: 'pre-aug2026' }, { gid: '748094009' }])).toEqual(['245473531', '860747164', '748094009']);
    // The hidden tab of retired classes the source read by gid.
    expect(() => resolveTabs(list, [{ gid: '35344992' }])).toThrow("tab gid 35344992 is not one of the sheet's visible tabs (hidden or deleted?)");
    expect(() => resolveTabs(list, [{ name: 'Current Records' }])).toThrow('no visible tab is named "Current Records"');
    expect(() => resolveTabs([{ name: 'A', gid: '1' }, { name: 'a', gid: '2' }], [{ name: 'A' }])).toThrow('several tabs are named "A"');
    expect(() => resolveTabs([], [{ gid: '0' }])).toThrow("the sheet's tab list is empty");
  });

  // The Junior and 16-17 tabs' gids were swapped when listed by hand.
  it('finds every New Jersey tab by name, Junior and U17 each on its own tab', () => {
    const list = sheetTabList(fixture('sheet-tabs-new-jersey-20261012.html'));
    const gids = resolveTabs(list, NEW_JERSEY_TABS.map(([name]) => ({ name })));
    const ageOf = (gid: string) => NEW_JERSEY_TABS[gids.indexOf(gid)]?.[1];
    expect(ageOf('2116279815')).toBe('Junior'); // "Junior Records (15-20)"
    expect(ageOf('336358523')).toBe('U17'); // "16-17 Youth Records"
    expect(ageOf('1099102775')).toBe('U11'); // "Under 11 Youth Records"
    expect(ageOf('2047529058')).toBe('Masters 75'); // "75-79  Masters Records", two spaces
    expect(new Set(gids).size).toBe(NEW_JERSEY_TABS.length);
  });
});
