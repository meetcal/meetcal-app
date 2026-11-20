import {
  NEW_ENGLAND_CMS_APP_ID,
  newEnglandAccessToken,
  newEnglandAgeCategory,
  newEnglandItemsPage,
  newEnglandItemsQuery,
  parseNewEngland,
} from '../../convex/scrapers/parse/wso/newEngland';

type Row = Record<string, unknown>;

const LIFTS = ['Snatch', 'Clean & Jerk', 'Total'] as const;

const classRows = (base: Row, perLift: (lift: (typeof LIFTS)[number]) => Row): Row[] =>
  LIFTS.map((lift) => ({ ...base, lift, title: `${String(base.division)} / ${String(base.sex)} / ${String(base.weightClass)} kg / ${lift}`, ...perLift(lift) }));

const record = (kg: number): Row => ({
  status: 'Record',
  kg,
  athlete: 'Cian Whitney',
  club: 'Bay State Barbell',
  meet: '2025 Bay State Games',
  recordDate: '2025-07-19',
  bodyweight: 29.7,
});

describe('New England WSO records from the CMS collection', () => {
  it('maps divisions and ages onto the stored age categories', () => {
    expect(newEnglandAgeCategory('Open', '')).toBe('Senior');
    expect(newEnglandAgeCategory('Junior', '')).toBe('Junior');
    expect(newEnglandAgeCategory('Youth', '11U')).toBe('U11');
    expect(newEnglandAgeCategory('Youth', '12/13')).toBe('U13');
    expect(newEnglandAgeCategory('Youth', '14/15')).toBe('U15');
    expect(newEnglandAgeCategory('Youth', '16/17')).toBe('U17');
    expect(newEnglandAgeCategory('Masters', '35-39')).toBe('Masters 35');
    expect(newEnglandAgeCategory('Masters', '80-84')).toBe('Masters 80');
    expect(newEnglandAgeCategory('Open', '35-39')).toBeNull();
    expect(newEnglandAgeCategory('Youth', '18/19')).toBeNull();
    expect(newEnglandAgeCategory('Masters', '')).toBeNull();
  });

  it('groups three lift rows into one class with holders from the athlete, date and meet', () => {
    const rows = classRows({ division: 'Youth', sex: 'Men', age: '12/13', weightClass: '32' }, (lift) => record({ Snatch: 40, 'Clean & Jerk': 52, Total: 92 }[lift]));
    const holder = { name: 'Cian Whitney', date: '2025-07-19', location: '2025 Bay State Games' };
    expect(parseNewEngland(rows, 'New England')).toEqual([
      { wso: 'New England', ageCategory: 'U13', gender: 'Men', weightClass: '32', snatchRecord: 40, cjRecord: 52, totalRecord: 92, snatchBy: holder, cjBy: holder, totalBy: holder },
    ]);
  });

  it('reads a standard as its weight held by "Standard", and an open class as no lift', () => {
    const rows = [
      ...classRows({ division: 'Open', sex: 'Women', age: '', weightClass: '86+' }, () => ({ status: 'Standard', kg: 100 })),
      ...classRows({ division: 'Junior', sex: 'Men', age: '', weightClass: '110+' }, () => ({ status: 'Open', kg: null })),
      ...classRows({ division: 'Masters', sex: 'Women', age: '55-59', weightClass: '63' }, (lift) => (lift === 'Total' ? { status: 'Standard', kg: 120 } : record(55))),
    ];
    const [senior, junior, masters] = parseNewEngland(rows, 'New England');
    expect(senior).toEqual({
      wso: 'New England', ageCategory: 'Senior', gender: 'Women', weightClass: '86+', snatchRecord: 100, cjRecord: 100, totalRecord: 100,
      snatchBy: { name: 'Standard' }, cjBy: { name: 'Standard' }, totalBy: { name: 'Standard' },
    });
    expect(junior).toEqual({ wso: 'New England', ageCategory: 'Junior', gender: 'Men', weightClass: '110+', snatchRecord: null, cjRecord: null, totalRecord: null });
    expect(masters).toMatchObject({ ageCategory: 'Masters 55', snatchRecord: 55, totalRecord: 120, snatchBy: { name: 'Cian Whitney' }, totalBy: { name: 'Standard' } });
  });

  it('fails a class missing a lift', () => {
    const rows = classRows({ division: 'Open', sex: 'Men', age: '', weightClass: '65' }, () => ({ status: 'Standard', kg: 100 })).slice(0, 2);
    expect(() => parseNewEngland(rows, 'New England')).toThrow('New England classes missing a lift: Senior|Men|65');
  });

  it('fails a lift listed twice', () => {
    const [snatch] = classRows({ division: 'Open', sex: 'Men', age: '', weightClass: '65' }, () => ({ status: 'Standard', kg: 100 }));
    expect(() => parseNewEngland([snatch, snatch], 'New England')).toThrow('listed twice');
  });

  it.each([
    ['an unknown division', { division: 'Para' }, 'unknown division'],
    ['an unknown sex', { sex: 'Mixed' }, 'unknown sex'],
    ['an unreadable weight class', { weightClass: '65kg' }, 'unreadable weight class'],
    ['an unknown status', { status: 'Pending' }, 'unknown status'],
    ['a record without a weight', { kg: null }, 'is not a whole positive number'],
    ['a record without an athlete', { athlete: '' }, 'a record with no athlete'],
  ])('fails %s instead of inventing a value', (_, change, message) => {
    const rows = classRows({ division: 'Open', sex: 'Men', age: '', weightClass: '65' }, () => ({ ...record(100), ...change }));
    expect(() => parseNewEngland(rows, 'New England')).toThrow(message);
  });

  it('fails an empty collection', () => {
    expect(() => parseNewEngland([], 'New England')).toThrow('parsed 0 records');
  });

  it('reads the CMS app token and refuses an answer without it', () => {
    expect(newEnglandAccessToken({ apps: { [NEW_ENGLAND_CMS_APP_ID]: { accessToken: 'visitor-token' } } })).toBe('visitor-token');
    expect(() => newEnglandAccessToken({ apps: {} })).toThrow(`no token for the CMS app ${NEW_ENGLAND_CMS_APP_ID}`);
    expect(() => newEnglandAccessToken({ apps: { [NEW_ENGLAND_CMS_APP_ID]: { accessToken: '' } } })).toThrow('no token');
  });

  it('reads each item’s data off a query page and refuses a malformed page', () => {
    expect(newEnglandItemsPage({ dataItems: [{ data: { lift: 'Total' } }] })).toEqual([{ lift: 'Total' }]);
    expect(() => newEnglandItemsPage({})).toThrow('without dataItems');
    expect(() => newEnglandItemsPage({ dataItems: [{}] })).toThrow('item 0 has no data');
  });

  it('queries the records collection a page at a time', () => {
    expect(newEnglandItemsQuery(400)).toEqual({ dataCollectionId: 'NewEnglandWeightliftingRecords', query: { paging: { limit: 200, offset: 400 } } });
  });
});
