import { copiedTabs, gvizCsvByGid, gvizCsvFirstTab, repeatedTabs } from '../../convex/scrapers/parse/wso/common';
import { OHIO_TAB_GIDS, OHIO_TABS } from '../../convex/scrapers/parse/wso/ohio';

describe('WSO sheet tabs', () => {
  it('fetches tabs by gid, never by name', () => {
    expect(gvizCsvByGid('abc', '0')).toBe('https://docs.google.com/spreadsheets/d/abc/gviz/tq?tqx=out:csv&gid=0');
    expect(gvizCsvFirstTab('abc')).toBe('https://docs.google.com/spreadsheets/d/abc/gviz/tq?tqx=out:csv');
  });

  it('knows a distinct gid for every Ohio tab', () => {
    const gids = OHIO_TABS.map((tab) => OHIO_TAB_GIDS[tab]);
    expect(gids.every((gid) => /^\d+$/.test(gid))).toBe(true);
    expect(new Set(gids).size).toBe(OHIO_TABS.length);
  });

  // Google answers a gid or name the sheet no longer has with its first tab,
  // so a deleted tab comes back as a copy of another.
  it('spots a tab that came back as a copy of another', () => {
    expect(repeatedTabs(['a', 'b', 'c'])).toEqual([]);
    expect(repeatedTabs(['first', 'b', 'first', 'c', 'b'])).toEqual([
      [2, 0],
      [4, 1],
    ]);
    expect(repeatedTabs([])).toEqual([]);
  });

  it('refuses a tab that came back as the first tab in place of its own', () => {
    // The wanted tabs include the first tab: only a repeat is a fallback.
    expect(copiedTabs(['0', '7'], ['youth', 'junior'], { gid: '0' })).toBeNull();
    expect(copiedTabs(['0', '7'], ['youth', 'youth'], { gid: '0' })).toBe('tab gid 0 and tab gid 7 are the same (a tab deleted, renumbered or moved first?)');
    expect(copiedTabs(['7'], ['flat'], { gid: '0' })).toBe('first tab gid 0 is not one of the tabs read');
    // They do not: a tab matching the first tab's CSV is one.
    expect(copiedTabs(['9'], ['detailed'], { csv: 'flat' })).toBeNull();
    expect(copiedTabs(['9'], ['flat'], { csv: 'flat' })).toBe("tab gid 9 and the sheet's first tab are the same (a tab deleted, renumbered or moved first?)");
    expect(copiedTabs(['8', '9'], ['a', 'a'], { csv: 'welcome' })).toBe('tab gid 8 and tab gid 9 are the same (a tab deleted, renumbered or moved first?)');
  });
});
