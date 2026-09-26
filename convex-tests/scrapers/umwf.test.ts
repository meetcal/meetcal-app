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
    expect(parseUmwfSheet(csv, 'Masters 30', 'men')).toEqual([
      { record_type: 'UMWF', age_category: 'Masters 30', gender: 'men', weight_class: '60kg', snatch_record: 104, cj_record: 128, total_record: 232 },
      { record_type: 'UMWF', age_category: 'Masters 30', gender: 'men', weight_class: '110+kg', snatch_record: 0, cj_record: 0, total_record: 210 },
    ]);
  });

  it('formats weight classes like the Python scraper', () => {
    expect(formatWeightClass('86+ kg Category')).toBe('86+kg');
    expect(formatWeightClass('60 KG Category')).toBe('60kg');
    expect(formatWeightClass('Category')).toBeNull();
  });
});
