import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sheetTabList } from '../../convex/scrapers/parse/wso/common';
import { parseTnkyTab, TNKY_GROUPS, tnkyTabGroup, tnkyTabs } from '../../convex/scrapers/parse/wso/tnky';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('Tennessee-Kentucky WSO sheet (a tab per group)', () => {
  afterEach(() => jest.useRealTimers());

  it('reads the age group and gender from a tab title', () => {
    expect(tnkyTabGroup('Youth Men <11')).toEqual(['U11', 'Men']);
    expect(tnkyTabGroup('Youth Women 12-13')).toEqual(['U13', 'Women']);
    expect(tnkyTabGroup('Youth Men 14-15')).toEqual(['U15', 'Men']);
    expect(tnkyTabGroup('Youth Women 16-17')).toEqual(['U17', 'Women']);
    expect(tnkyTabGroup('Juniors Women 15-20')).toEqual(['Junior', 'Women']);
    expect(tnkyTabGroup('Seniors Men >15')).toEqual(['Senior', 'Men']);
    expect(tnkyTabGroup('Masters Women 50-55')).toEqual(['Masters 50', 'Women']);
    expect(tnkyTabGroup('Masters  Men 80-84')).toEqual(['Masters 80', 'Men']);
    expect(tnkyTabGroup('Masters Women 85+')).toEqual(['Masters 85', 'Women']);
    // The old sheet's youth ranges are not this sheet's age groups.
    expect(tnkyTabGroup('Youth Men 14-17')).toBeNull();
    expect(tnkyTabGroup('TN-KY WSO Records through May 31, 2025')).toBeNull();
    expect(tnkyTabGroup('Youth Men')).toBeNull();
  });

  it("finds a tab for every group in the sheet's tab list", () => {
    const tabs = tnkyTabs(sheetTabList(fixture('sheet-tabs-tennessee-kentucky-20261015.html')));
    expect(tabs).toHaveLength(TNKY_GROUPS.length);
    expect(tabs.find((tab) => tab.gid === '851531892')).toMatchObject({ age: 'U15', gender: 'Men' });
    expect(tabs.find((tab) => tab.gid === '498006525')).toMatchObject({ age: 'Masters 80', gender: 'Men' });
    expect(tabs.find((tab) => tab.gid === '101457918')).toMatchObject({ age: 'Masters 85', gender: 'Women' });
  });

  it('fails when a group has no tab or two', () => {
    const list = sheetTabList(fixture('sheet-tabs-tennessee-kentucky-20261015.html'));
    expect(() => tnkyTabs(list.filter((tab) => tab.gid !== '851531892'))).toThrow('no visible tab for U15 Men (renamed or hidden?)');
    expect(() => tnkyTabs([...list, { name: 'Copy of Youth Men 14-15', gid: '1' }])).toThrow('tabs "Youth Men 14-15" and "Copy of Youth Men 14-15" are both U15 Men');
  });

  it("reads the new sheet's classes, holders written LAST, First", () => {
    const records = parseTnkyTab(fixture('tnky-seniors-men-20261015.csv'), 'Tennessee-Kentucky', 'Senior', 'Men');
    expect(records.map((r) => r.weight_class)).toEqual(['60', '65', '70', '75', '85', '95', '110', '110+']);
    expect(records.find((r) => r.weight_class === '110')).toEqual({
      wso: 'Tennessee-Kentucky',
      age_category: 'Senior',
      gender: 'Men',
      weight_class: '110',
      snatch_record: 116,
      cj_record: 140,
      total_record: 256,
      snatch_by: { name: 'BROWN, Zachary', date: '2026-09-13', location: '2026 Virus Weightlifting Series 2' },
      cj_by: { name: 'BROWN, Zachary', date: '2026-09-13', location: '2026 Virus Weightlifting Series 2' },
      total_by: { name: 'BROWN, Zachary', date: '2026-09-13', location: '2026 Virus Weightlifting Series 2' },
    });
  });

  // The old sheet's tabs, laid out the same way.
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
