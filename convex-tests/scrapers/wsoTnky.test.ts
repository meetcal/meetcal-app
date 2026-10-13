import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sheetTabList } from '../../convex/scrapers/parse/wso/common';
import { parseTnkyTab, TNKY_GROUPS, tnkyTabGroup, tnkyTabs } from '../../convex/scrapers/parse/wso/tnky';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('Tennessee-Kentucky WSO sheet (a tab per group)', () => {
  afterEach(() => jest.useRealTimers());

  it('reads the age group and gender from a tab title', () => {
    expect(tnkyTabGroup('6/1/25-8/1/26 Youth Men <13')).toEqual(['U13', 'Men']);
    expect(tnkyTabGroup('Copy of Youth Women <13')).toEqual(['U13', 'Women']);
    expect(tnkyTabGroup('Copy of Youth Men 14-17')).toEqual(['U17', 'Men']);
    expect(tnkyTabGroup('Copy of Juniors Women 15-20')).toEqual(['Junior', 'Women']);
    expect(tnkyTabGroup('Copy of Seniors Men >15')).toEqual(['Senior', 'Men']);
    expect(tnkyTabGroup('Copy of Masters Women 50-55')).toEqual(['Masters 50', 'Women']);
    expect(tnkyTabGroup('Masters Men 65-69')).toEqual(['Masters 65', 'Men']);
    expect(tnkyTabGroup('TN-KY WSO Records through May 31, 2025')).toBeNull();
    expect(tnkyTabGroup('Youth Men')).toBeNull();
  });

  it("finds a tab for every group in the sheet's tab list, skipping the archived one", () => {
    const tabs = tnkyTabs(sheetTabList(fixture('sheet-tabs-tennessee-kentucky-20261012.html')));
    expect(tabs).toHaveLength(TNKY_GROUPS.length);
    expect(tabs.find((tab) => tab.gid === '104344990')).toMatchObject({ age: 'U17', gender: 'Men' });
    expect(tabs.some((tab) => tab.gid === '526394508')).toBe(false);
  });

  it('fails when a group has no tab or two', () => {
    const list = sheetTabList(fixture('sheet-tabs-tennessee-kentucky-20261012.html'));
    expect(() => tnkyTabs(list.filter((tab) => tab.gid !== '104344990'))).toThrow('no visible tab for U17 Men (renamed or hidden?)');
    expect(() => tnkyTabs([...list, { name: '8/1/26- Youth Men 14-17', gid: '1' }])).toThrow('tabs "Copy of Youth Men 14-17" and "8/1/26- Youth Men 14-17" are both U17 Men');
  });

  it('reads a class row, then a row per lift: name, weight, date and meet', () => {
    jest.useFakeTimers({ now: new Date('2027-01-15T12:00:00Z') });
    const records = parseTnkyTab(fixture('tnky-youth-men-14-17-20261012.csv'), 'Tennessee-Kentucky', 'U17', 'Men');
    expect(records.map((r) => r.weight_class)).toEqual(['48', '52', '56', '60', '65', '71', '79', '88', '94', '94+']);
    expect(records[0]).toEqual({ wso: 'Tennessee-Kentucky', age_category: 'U17', gender: 'Men', weight_class: '48', snatch_record: null, cj_record: null, total_record: null });
    expect(records[3]).toEqual({
      wso: 'Tennessee-Kentucky',
      age_category: 'U17',
      gender: 'Men',
      weight_class: '60',
      snatch_record: 48,
      cj_record: 66,
      total_record: 117,
      snatch_by: { name: 'Gideon Hayhoe', date: '2026-03-05', location: '2026 Virus Series 1' },
      cj_by: { name: 'Gideon Hayhoe', date: '2026-03-05', location: '2026 Virus Series 1' },
      total_by: { name: 'Gideon Hayhoe', date: '2026-03-05', location: '2026 Virus Series 1' },
    });
    // "12/7/2026" at the 2025 Virus Series Finals, read as 2025 after December 2026 too.
    const whitlock = records.find((r) => r.snatch_by?.name === 'Xander Whitlock');
    expect(whitlock).toMatchObject({ snatch_record: 93, cj_record: 120, total_record: 213, snatch_by: { date: '2025-12-07' }, total_by: { date: '2025-12-07' } });
  });

  it('keeps the later listing of a class written twice ("77KG*")', () => {
    const records = parseTnkyTab(fixture('tnky-seniors-women-20261012.csv'), 'Tennessee-Kentucky', 'Senior', 'Women');
    expect(records.map((r) => r.weight_class)).toEqual(['48', '53', '58', '63', '69', '77', '86', '86+']);
    expect(records.find((r) => r.weight_class === '77')).toMatchObject({ snatch_record: 124, cj_record: 153, total_record: 277, total_by: { name: 'Olivia Reeves' } });
  });

  it('fails on a lift cell it cannot read, or a lift row before any class', () => {
    expect(() => parseTnkyTab('Lift,Name,Weight,Date,Meet\n,40KG,,,\nSnatch,A,102 kg,1/1/2025,M', 'Tennessee-Kentucky', 'U13', 'Men')).toThrow('unreadable lift value "102 kg"');
    expect(() => parseTnkyTab('Lift,Name,Weight,Date,Meet\nSnatch,A,40,1/1/2025,M', 'Tennessee-Kentucky', 'U13', 'Men')).toThrow('a Snatch row before any class');
  });
});
