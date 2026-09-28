import { parseCsv } from '../../convex/scrapers/lib/csv';
import { formatWeightClass, parseUmwfSheet } from '../../convex/scrapers/parse/umwf';

describe('CSV reader (Python csv.reader semantics)', () => {
  it('handles quotes, doubled quotes, embedded commas and newlines, CRLF and blank lines', () => {
    expect(parseCsv('a,"b,c","say ""hi"""\r\n\r\n,"multi\nline",x\n')).toEqual([
      ['a', 'b,c', 'say "hi"'],
      [],
      ['', 'multi\nline', 'x'],
    ]);
    expect(parseCsv('last,row')).toEqual([['last', 'row']]);
  });
});

describe('UMWF sheet parser (port of umwf_records.py)', () => {
  const csv = [
    ',UMWF World Records,,',
    ',60 kg Category,,',
    ',Snatch,104,DOE Jan',
    ',Clean & Jerk,128.5,DOE Jan',
    ',Total,232,DOE Jan',
    ',110+ kg Category,,',
    ',Snatch,Standard,',
    ',Clean & Jerk,,',
    ',Total,210,',
    ',Notes,n/a,',
  ].join('\n');

  it('opens a class per "kg Category" row and fills its lifts', () => {
    expect(parseUmwfSheet(csv, 'Masters 30', 'men')).toMatchObject([
      { record_type: 'UMWF', age_category: 'Masters 30', gender: 'men', weight_class: '60kg', snatch_record: 104, cj_record: 128, total_record: 232 },
      { record_type: 'UMWF', age_category: 'Masters 30', gender: 'men', weight_class: '110+kg', snatch_record: 0, cj_record: 0, total_record: 210 },
    ]);
  });

  it('records who set each lift from the Name, Date and Where columns', () => {
    const sheet = [
      ',MEN 35 - 39,,,,,,,,',
      ',60 kg Category,Weight,Name,Year Born,Nation,Date,Where,Age,x',
      ',Snatch,76,"PUFF, Derick",1989,USA,07-December-2025,"Daytona Beach, FL",36,X',
      ',Clean & Jerk,88,Standard,,,,,,X',
      ',Total,150,"YATES, Leora",1975,AUS,10-June_2026,"Adelaide, SA",51,x',
      ',98 kg Category (retired),,,,13-June-2025,Singapore,,x',
      ',Snatch,,Standard,,,,,,x',
      ',Clean & Jerk,Standard,,,,,,,x',
      ',Total,210,"CASSIDY, Wes",1969,AUS,10-June-0206,"Adelaide, SA",57,',
    ].join('\n');
    const [light, retired] = parseUmwfSheet(sheet, 'Masters 35', 'men');
    expect(light.snatch_by).toEqual({ name: 'PUFF, Derick', date: '2025-12-07', location: 'Daytona Beach, FL' });
    expect(light.cj_by).toEqual({ name: 'Standard' });
    // "10-June_2026" is still a readable date.
    expect(light.total_by).toEqual({ name: 'YATES, Leora', date: '2026-06-10', location: 'Adelaide, SA' });
    // No value (blank or "Standard"): no holder; the sheet's "0206" is corrected (`correctRecordDate`).
    expect(retired).not.toHaveProperty('snatch_by');
    expect(retired).not.toHaveProperty('cj_by');
    expect(retired.total_by).toEqual({ name: 'CASSIDY, Wes', date: '2026-06-10', location: 'Adelaide, SA' });
  });

  it('formats weight classes like the Python scraper', () => {
    expect(formatWeightClass('86+ kg Category')).toBe('86+kg');
    expect(formatWeightClass('60 KG Category')).toBe('60kg');
    expect(formatWeightClass('Category')).toBeNull();
  });
});
