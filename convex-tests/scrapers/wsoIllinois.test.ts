import { illinoisPdfHref, parseIllinois } from '../../convex/scrapers/parse/wso/illinois';

const AGES = ['U13', 'U15', 'U17', 'JR', 'Open', ...Array.from({ length: 12 }, (_, i) => String(35 + i * 5))];

/** A PDF's worth of lines: every age group for both genders, enough classes to pass the size checks. */
function fullPdf(extra: string[] = []): string[] {
  const lines = ['Age Group Gender Category Lift Record Record Holder Name Date'];
  for (const gender of ['F', 'M']) {
    for (const age of AGES) {
      const label = /^\d/.test(age) ? `${gender === 'F' ? 'W' : 'M'}${age}` : age;
      for (const weight of ['55', '59', '60', '64', '65', '71', '81', '>81']) {
        for (const lift of ['Snatch', 'Clean & Jerk', 'Total']) lines.push(`${label} ${gender} ${weight} ${lift} 50 STANDARD 2026-08-01`);
      }
    }
  }
  return lines.concat(extra);
}

describe('Illinois WSO PDF (port of scraper_pdf_illinois.py)', () => {
  it('reads one line per lift into records per class', () => {
    const { records } = parseIllinois(fullPdf(), 'Illinois');
    expect(records).toHaveLength(272);
    expect(records[0]).toMatchObject({ wso: 'Illinois', age_category: 'U13', gender: 'Women', weight_class: '55', snatch_record: 50, cj_record: 50, total_record: 50 });
    expect(records.find((r) => r.age_category === 'Masters 90' && r.gender === 'Men' && r.weight_class === '81+')).toBeTruthy();
  });

  it('prefers a real value over a 0 duplicate and fails on a real conflict or an unreadable row', () => {
    const lines = fullPdf(['U13 F 60 Snatch 0 STANDARD 2026-08-01', 'U13 M 60 Total 0 X 2026-08-01']);
    expect(parseIllinois(lines, 'Illinois').warnings).toEqual([
      'Ignored zero duplicate in favor of 50: U13 F 60 Snatch 0 STANDARD 2026-08-01',
      'Ignored zero duplicate in favor of 50: U13 M 60 Total 0 X 2026-08-01',
    ]);
    expect(() => parseIllinois(fullPdf(['U13 F 60 Snatch 51 A 2026-08-01']), 'Illinois')).toThrow('Conflicting Illinois values');
    expect(() => parseIllinois(fullPdf(['U13 F 60 Snatch fifty A 2026-08-01']), 'Illinois')).toThrow('Could not parse 1 Illinois record rows');
    expect(() => parseIllinois(fullPdf(['W35 M 60 Snatch 50 A 2026-08-01']), 'Illinois')).toThrow('age/gender mismatch');
  });

  it('names the holder and date of each lift, STANDARD as Standard, the holder going with the value kept', () => {
    const lines = fullPdf(['U13 F 60 Snatch 0 Someone Else 2025-01-01', 'U13 M 60 Total 50 Late Duplicate 2025-01-01']).map((line) =>
      line
        .replace('U13 F 60 Clean & Jerk 50 STANDARD 2026-08-01', 'U13 F 60 Clean & Jerk 62 Summer De La Cruz 2025-10-26')
        .replace('U13 M 60 Total 50 STANDARD 2026-08-01', 'U13 M 60 Total 0 STANDARD 2026-08-01'),
    );
    const noSnatch = lines.filter((line) => line !== 'U15 F 55 Snatch 50 STANDARD 2026-08-01');
    const { records } = parseIllinois(noSnatch, 'Illinois');
    const find = (age: string, gender: string, weight: string) => records.find((r) => r.age_category === age && r.gender === gender && r.weight_class === weight);
    expect(find('U13', 'Women', '60')).toMatchObject({
      snatch_record: 50,
      snatch_by: { name: 'Standard', date: '2026-08-01' },
      cj_record: 62,
      cj_by: { name: 'Summer De La Cruz', date: '2025-10-26' },
    });
    expect(find('U13', 'Men', '60')).toMatchObject({ total_record: 50, total_by: { name: 'Late Duplicate', date: '2025-01-01' } });
    const missing = find('U15', 'Women', '55');
    expect(missing).toMatchObject({ snatch_record: null, cj_record: 50, cj_by: { name: 'Standard', date: '2026-08-01' } });
    expect(missing).not.toHaveProperty('snatch_by');
  });

  it('refuses a PDF that looks incomplete, since the set is synced exactly', () => {
    expect(() => parseIllinois(fullPdf().slice(0, 300), 'Illinois')).toThrow(/only \d+ record rows/);
  });

  it("finds the records link in the page's records section", () => {
    const html = '<a href="/other.pdf">View Records</a> Illinois State Records <p>..</p><a class="b" href="/s/IL-WSO-Records-20260913.pdf">View the Records</a>';
    expect(illinoisPdfHref(html)).toBe('/s/IL-WSO-Records-20260913.pdf');
    expect(() => illinoisPdfHref('<p>nothing</p>')).toThrow('Could not find');
  });
});
