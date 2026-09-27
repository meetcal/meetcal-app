import type { PdfLine } from '../../convex/scrapers/lib/pdf';
import { newEnglandPdfUrls, newEnglandSection, parseNewEngland } from '../../convex/scrapers/parse/wso/newEngland';

// Column centres as the PDFs lay them out.
const AT = { Class: 137, Lift: 188, Name: 272, Representing: 388, 'Location/Meet': 520, Weight: 612, Date: 655 };

function line(cells: Partial<Record<keyof typeof AT, string>>): PdfLine {
  const runs = Object.entries(cells).map(([column, text]) => ({ text: text!, x: AT[column as keyof typeof AT] - 5, end: AT[column as keyof typeof AT] + 5 }));
  return { text: runs.map((r) => r.text).join(' '), runs };
}

const header = line({ Class: 'Class', Lift: 'Lift', Name: 'Name', Representing: 'Representing', 'Location/Meet': 'Location/Meet', Weight: 'Weight', Date: 'Date' });

describe('New England WSO PDFs (port of scraper_pdf_newengland.py)', () => {
  it('reads titles', () => {
    expect(newEnglandSection("16/17 Youth Men's Records")).toEqual(['U17', 'Men']);
    expect(newEnglandSection("13U Youth Women's Records")).toEqual(['U13', 'Women']);
    expect(newEnglandSection("Open Women's Records")).toEqual(['Senior', 'Women']);
    expect(newEnglandSection("35-39 Masters Men's Records")).toEqual(['Masters 35', 'Men']);
  });

  it('reads the Weight column by position, "Open" and "Standard" rows included', () => {
    const page: PdfLine[] = [
      { text: "13U Youth Men's Records", runs: [{ text: "13U Youth Men's Records", x: 267, end: 526 }] },
      header,
      line({ Lift: 'Snatch', Name: 'A Lifter (29.70)', Representing: 'Club', 'Location/Meet': '2025 Games 2025', Weight: '25', Date: '7/19/2025' }),
      line({ Class: '40', Lift: 'C&J', Name: 'A Lifter (29.70)', Representing: 'Club', 'Location/Meet': '2025 Games', Weight: '30', Date: '7/19/2025' }),
      line({ Lift: 'Total', Name: 'A Lifter (29.70)', Representing: 'Club', 'Location/Meet': 'Meet 2025' }),
      line({ Lift: 'Snatch', Name: 'Open' }),
      line({ Class: '44+', Lift: 'C&J', Name: 'Standard', Weight: '121' }),
      line({ Lift: 'Total', Name: 'Open' }),
    ];
    expect(parseNewEngland([page], 'New England').map((r) => [r.age_category, r.weight_class, r.snatch_record, r.cj_record, r.total_record])).toEqual([
      ['U13', '40', 25, 30, null],
      ['U13', '44+', null, 121, null],
    ]);
  });

  it('reads who set each lift, less the bodyweight after the name', () => {
    const page: PdfLine[] = [
      { text: "13U Youth Men's Records", runs: [{ text: "13U Youth Men's Records", x: 267, end: 526 }] },
      header,
      line({ Lift: 'Snatch', Name: 'Cian Whitney (29.70)', Representing: 'Rose Barbell Club', 'Location/Meet': '2025 Bay State Games', Weight: '25', Date: '7/19/2025' }),
      line({ Class: '40', Lift: 'C&J', Name: 'Standard', Weight: '30' }),
      line({ Lift: 'Total', Name: 'Beckett Roche (38)', Representing: 'Unaffiliated', 'Location/Meet': "Strength Paddy's Day Classic", Weight: '55', Date: '3/21/2026' }),
      line({ Lift: 'Snatch', Name: 'Open' }),
      line({ Class: '44', Lift: 'C&J', Name: 'Sarah StGermain (52.2)', Weight: '66', Date: '4/26/2026' }),
      line({ Lift: 'Total', Name: 'A Lifter (Jr)', Weight: '100' }),
    ];
    const [first, second] = parseNewEngland([page], 'New England');
    expect(first).toMatchObject({
      snatch_by: { name: 'Cian Whitney', date: '2025-07-19', location: '2025 Bay State Games' },
      total_by: { name: 'Beckett Roche', date: '2026-03-21', location: "Strength Paddy's Day Classic" },
    });
    expect(first.cj_by).toEqual({ name: 'Standard' });
    expect(second).not.toHaveProperty('snatch_by');
    expect(second.cj_by).toEqual({ name: 'Sarah StGermain', date: '2026-04-26' });
    // Only a number in parentheses is a bodyweight.
    expect(second.total_by).toEqual({ name: 'A Lifter (Jr)' });
  });

  it('finds every records PDF the page links, once each', () => {
    const pdf = (id: string) => `<a href="https://www.newenglandweightlifting.com/_files/ugd/7cfa8e_${id}.pdf">See Records</a>`;
    expect(newEnglandPdfUrls(pdf('a') + pdf('b') + pdf('a')).map((u) => u.slice(-6))).toEqual(['_a.pdf', '_b.pdf']);
  });
});
