import { recordRow, tally } from '../../convex/scrapers/lib/recordRows';

const senior = { ageCategory: 'Senior', gender: 'Women', weightClass: '63kg' };
const storedLifts = (lifts: Omit<Parameters<typeof recordRow>[1], keyof typeof senior>, options?: { zeroMeansNoRecord?: boolean }) => {
  const { recordType, ageCategory, gender, weightClass, ...stored } = recordRow({ recordType: 'national' }, { ...senior, ...lifts }, options);
  expect({ recordType, ageCategory, gender, weightClass }).toEqual({ recordType: 'national', ...senior });
  return stored;
};

describe('record rows as the record syncs send them (#573)', () => {
  const holder = { name: 'Ann Lee', date: '2026-06-20' };

  it('sends a lift the source left out as missing, and keeps a lift of 0 unless the source uses 0 for no record', () => {
    expect(storedLifts({ snatchRecord: 100, cjRecord: null, totalRecord: undefined, snatchBy: holder })).toEqual({ snatchRecord: 100, cjRecord: undefined, totalRecord: undefined, snatchBy: holder, cjBy: undefined, totalBy: undefined });
    expect(storedLifts({ snatchRecord: 0, cjRecord: 120 })).toMatchObject({ snatchRecord: 0, cjRecord: 120 });
    expect(storedLifts({ snatchRecord: 0, cjRecord: 120 }, { zeroMeansNoRecord: true })).toMatchObject({ snatchRecord: undefined, cjRecord: 120 });
  });

  it('counts what an upsert inserted, changed and left alone', () => {
    expect(tally([{ wasInsert: true, wasChanged: true }, { wasInsert: false, wasChanged: true }, { wasInsert: false, wasChanged: false }, { wasInsert: false, wasChanged: false }])).toEqual({ inserted: 1, updated: 1, unchanged: 2 });
    expect(tally([])).toEqual({ inserted: 0, updated: 0, unchanged: 0 });
  });
});
