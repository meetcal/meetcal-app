import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { illinoisPdfHref, parseIllinois } from '../../convex/scrapers/parse/wso/illinois';

/** The lines of IL-WSO-Records-20261004.pdf (revised October 4, 2026) as `pdfLines` reads them. */
const OCTOBER_2026 = readFileSync(join(__dirname, 'fixtures/illinois-records-20261004.txt'), 'utf8').split('\n');

/** The fixture without page `n`: its lines up to and including its footer ("n of 15 ..."). */
function withoutPage(n: number): string[] {
  const footer = (page: number) => OCTOBER_2026.findIndex((line) => line.startsWith(`${page} of 15 `));
  const start = n === 1 ? 0 : footer(n - 1) + 1;
  return [...OCTOBER_2026.slice(0, start), ...OCTOBER_2026.slice(footer(n) + 1)];
}

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
  it('reads the October 2026 PDF to exactly its 256 classes, U11 added and U13/U15 gone', () => {
    const { records } = parseIllinois(OCTOBER_2026, 'Illinois');
    expect(records).toHaveLength(256);
    const ages = new Map<string, number>();
    for (const r of records) ages.set(`${r.gender} ${r.age_category}`, (ages.get(`${r.gender} ${r.age_category}`) ?? 0) + 1);
    // 16 age groups a gender, 8 classes each.
    expect(ages.size).toBe(32);
    expect([...ages.values()].every((count) => count === 8)).toBe(true);
    expect(ages.get('Women U11')).toBe(8);
    expect(ages.get('Men U11')).toBe(8);
    for (const gone of ['Women U13', 'Men U13', 'Women U15', 'Men U15']) expect(ages.has(gone)).toBe(false);
    const u17 = records.filter((r) => r.age_category === 'U17').map((r) => `${r.gender} ${r.weight_class}`);
    expect(u17).not.toContain('Women 37');
    expect(u17).not.toContain('Men 32');
    expect(records.every((r) => r.snatch_record !== null && r.cj_record !== null && r.total_record !== null)).toBe(true);
  });

  it('reads kg values, "Aug 1, 2026" dates, the place, and a name run into its date', () => {
    const { records } = parseIllinois(OCTOBER_2026, 'Illinois');
    const find = (age: string, gender: string, weight: string) => records.find((r) => r.age_category === age && r.gender === gender && r.weight_class === weight);
    const midAm = 'Mid American Championships';
    expect(find('Junior', 'Women', '61')).toEqual({
      wso: 'Illinois',
      age_category: 'Junior',
      gender: 'Women',
      weight_class: '61',
      snatch_record: 42,
      snatch_by: { name: 'BAKER, Sophie', date: '2026-10-03', location: `20267 ${midAm}` },
      cj_record: 54,
      cj_by: { name: 'BAKER, Sophie', date: '2026-10-03', location: `20267 ${midAm}` },
      total_record: 96,
      total_by: { name: 'BAKER, Sophie', date: '2026-10-03', location: `20267 ${midAm}` },
    });
    // No place for older records; STANDARD is a Standard holder.
    expect(find('Junior', 'Women', '53')).toMatchObject({ snatch_record: 54, snatch_by: { name: 'Mila Skibinski', date: '2025-10-26' } });
    expect(find('Junior', 'Women', '53')?.snatch_by).not.toHaveProperty('location');
    expect(find('Junior', 'Women', '49')).toMatchObject({ snatch_record: 43, snatch_by: { name: 'Standard', date: '2026-08-01' }, total_record: 97 });
    // "LLOP KASSINGER, CarmenOct 3, 2026"
    expect(find('Masters 55', 'Women', '61')).toMatchObject({ total_record: 94, total_by: { name: 'LLOP KASSINGER, Carmen', date: '2026-10-03', location: '2026 Mid American CHampionships' } });
    // A first name that starts like a month, run into the date.
    const binder = parseIllinois(
      OCTOBER_2026.map((line) => line.replace(/^M50 M 85 Snatch \d+ kg .*$/, 'M50 M 85 Snatch 79 kg BINDER, MarkOct 4, 2026 2026 Mid American Championships')),
      'Illinois',
    ).records.find((r) => r.age_category === 'Masters 50' && r.gender === 'Men' && r.weight_class === '85');
    expect(binder?.snatch_by).toEqual({ name: 'BINDER, Mark', date: '2026-10-04', location: '2026 Mid American Championships' });
    expect(find('Junior', 'Women', '86+')).toMatchObject({ snatch_record: 83, cj_record: 106, total_record: 189 });
    // 0 kg: a class nobody holds, with no holder.
    expect(find('Junior', 'Women', '86')).toEqual({ wso: 'Illinois', age_category: 'Junior', gender: 'Women', weight_class: '86', snatch_record: 0, cj_record: 0, total_record: 0 });
    expect(find('U11', 'Men', '65+')).toMatchObject({ snatch_record: 0, cj_record: 0, total_record: 0 });
    expect(find('Masters 90', 'Men', '110+')).toBeTruthy();
  });

  it('corrects only a total checked against results, and logs any other total over the lifts as written', () => {
    const { records, warnings } = parseIllinois(OCTOBER_2026, 'Illinois');
    const find = (age: string, gender: string, weight: string) => records.find((r) => r.age_category === age && r.gender === gender && r.weight_class === weight);
    // Written 1580; she made 66 + 84 = 150 at the 2026 Mid American Championships.
    expect(find('Masters 40', 'Women', '69')).toMatchObject({ snatch_record: 66, cj_record: 84, total_record: 150, total_by: { name: 'ROSARIO, Stephanie', date: '2026-10-03' } });
    // Kept: the PDF doesn't say whether the total or a lift is the slip (Lund's lift is; Wegrzyn's total is).
    expect(find('Masters 50', 'Men', '110+')).toMatchObject({ snatch_record: 62, cj_record: 84, total_record: 147 });
    expect(find('U17', 'Women', '61')).toMatchObject({ snatch_record: 35, cj_record: 51, total_record: 104 });
    expect(warnings).toEqual([
      'Source total (104) is above snatch + clean & jerk (86); kept as written: U17 Women 61',
      'Corrected source total 1580 to 150 (checked against results): Masters 40 Women 69',
      'Source total (147) is above snatch + clean & jerk (146); kept as written: Masters 50 Men 110+',
    ]);
  });

  it('applies a correction only while the PDF still has the value it was checked against', () => {
    const rosario = (total: string) => {
      const lines = OCTOBER_2026.map((line) => line.replace(/^(W40 F 69 Total) 1580 kg/, `$1 ${total} kg`));
      const { records, warnings } = parseIllinois(lines, 'Illinois');
      return { total: records.find((r) => r.age_category === 'Masters 40' && r.gender === 'Women' && r.weight_class === '69')?.total_record, warnings };
    };
    expect(rosario('150')).toMatchObject({ total: 150 });
    expect(rosario('150').warnings.some((w) => w.includes('Masters 40 Women 69'))).toBe(false);
    expect(rosario('1590').total).toBe(1590);
    expect(rosario('1590').warnings).toContain('Source total (1590) is above snatch + clean & jerk (150); kept as written: Masters 40 Women 69');
  });

  it('reads one line per lift into records per class (the format before October 2026)', () => {
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

  it('keeps a right total when a lift lost a digit', () => {
    const lines = OCTOBER_2026.map((line) => line.replace(/^(M50 M >110 Clean & Jerk) 84 kg/, '$1 8 kg'));
    const lund = parseIllinois(lines, 'Illinois').records.find((r) => r.age_category === 'Masters 50' && r.gender === 'Men' && r.weight_class === '110+');
    expect(lund).toMatchObject({ snatch_record: 62, cj_record: 8, total_record: 147 });
    // 170 with a digit dropped is 62 + 8: still kept.
    const jr = OCTOBER_2026.map((line) =>
      line.replace(/^(JR F 77 Snatch) 92 kg/, '$1 62 kg').replace(/^(JR F 77 Clean & Jerk) 115 kg/, '$1 8 kg').replace(/^(JR F 77 Total) 207 kg/, '$1 170 kg'),
    );
    expect(parseIllinois(jr, 'Illinois').records.find((r) => r.age_category === 'Junior' && r.gender === 'Women' && r.weight_class === '77')).toMatchObject({ total_record: 170 });
  });

  it('refuses a PDF missing an adult age group, as a lost page reads', () => {
    expect(() => parseIllinois(OCTOBER_2026.filter((line) => !line.startsWith('W55 F ')), 'Illinois')).toThrow('Illinois PDF is missing Women age groups: Masters 55');
  });

  it('refuses a PDF with a page missing, by its footers', () => {
    expect(() => parseIllinois(withoutPage(1), 'Illinois')).toThrow('Illinois PDF is missing pages 1 (by its page footers)');
    expect(() => parseIllinois(withoutPage(4), 'Illinois')).toThrow('Illinois PDF is missing pages 4 (by its page footers)');
    // The last records page (the end of Men U11, all of Men U17): its footer is the last, so the classes don't match.
    expect(() => parseIllinois(withoutPage(14), 'Illinois')).toThrow('Illinois PDF has 8 Women and 2 Men U11 classes (part of the PDF not read?)');
    expect(() => parseIllinois(withoutPage(14).filter((line) => !/^\d+ of 15 /.test(line)), 'Illinois')).toThrow('Men U11 classes');
  });

  it('refuses an age group read for one gender only, but takes one gone from both as the source dropping it', () => {
    expect(() => parseIllinois(OCTOBER_2026.filter((line) => !line.startsWith('U11 F ')), 'Illinois')).toThrow('Illinois PDF has 0 Women and 8 Men U11 classes');
    // How the October PDF dropped U13 and U15.
    const { records } = parseIllinois(OCTOBER_2026.filter((line) => !line.startsWith('U11 ')), 'Illinois');
    expect(records).toHaveLength(240);
  });

  it('refuses a PDF that looks incomplete, since the set is synced exactly', () => {
    expect(() => parseIllinois(fullPdf().slice(0, 300), 'Illinois')).toThrow(/only \d+ record rows/);
    // One gender's classes alone.
    expect(() => parseIllinois(OCTOBER_2026.filter((line) => !/^\S+ M /.test(line)), 'Illinois')).toThrow('Illinois PDF yielded only 128 record rows; expected at least 150');
  });

  it("finds the records link in the page's records section", () => {
    const html = '<a href="/other.pdf">View Records</a> Illinois State Records <p>..</p><a class="b" href="/s/IL-WSO-Records-20260913.pdf">View the Records</a>';
    expect(illinoisPdfHref(html)).toBe('/s/IL-WSO-Records-20260913.pdf');
    expect(() => illinoisPdfHref('<p>nothing</p>')).toThrow('Could not find');
  });

  it('finds the link past a banner that mentions the records far above it', () => {
    // The page since October 2026: a banner at the top, the section ~60 KB further down.
    const page = (href: string) =>
      '<p>Illinois State Records are updated! Scroll down to see where you stand!</p>' +
      '<div>'.padEnd(60_000, '.') +
      '<h2>Illinois State Records</h2><a href="/s/guide.pdf">USAW Guide</a>' +
      `<a href="${href}" class="sqs-block-button-element" data-sqsp-button target="_blank" > View the Records </a>`;
    expect(illinoisPdfHref(page('/s/IL-WSO-Records-20261004.pdf'))).toBe('/s/IL-WSO-Records-20261004.pdf');
    // A renamed file: the button after the heading.
    expect(illinoisPdfHref(page('/s/records-oct.pdf'))).toBe('/s/records-oct.pdf');
  });

  it("reads the records section's buttons only, the newest by its file's date", () => {
    // Squarespace's page: the banner and each block in its own <section>.
    const sections = (...bodies: string[]) => bodies.map((body) => `<section class="page-section">${body}</section>`).join('');
    const banner = '<p>Illinois State Records are updated!</p><a href="/s/club.pdf">View Records</a>';
    const heading = '<h2>Illinois State Records</h2><h3>Records are updated to reflect the new IWF Categories!</h3>';
    const button = (href: string) => `<a href="${href}" class="sqs-block-button-element"> View the Records </a>`;
    expect(illinoisPdfHref(sections(banner, heading + button('/s/records-oct.pdf')))).toBe('/s/records-oct.pdf');
    expect(illinoisPdfHref(sections(button('/s/IL-WSO-Records-20260913.pdf'), heading + button('/s/records-oct.pdf')))).toBe('/s/records-oct.pdf');
    expect(illinoisPdfHref(sections(heading + button('/s/IL-WSO-Records-20260913.pdf') + button('/s/IL-WSO-Records-20261004.pdf')))).toBe('/s/IL-WSO-Records-20261004.pdf');
    // Without sections: from the heading on, so a button above it is not taken.
    expect(illinoisPdfHref(`${banner}${heading}${button('/s/records-oct.pdf')}`)).toBe('/s/records-oct.pdf');
    expect(() => illinoisPdfHref(sections(banner, heading))).toThrow('Could not find the Illinois records PDF URL');
  });
});
