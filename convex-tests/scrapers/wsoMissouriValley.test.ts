import { missouriValleyAge, missouriValleyLines, parseMissouriValley } from '../../convex/scrapers/parse/wso/missouriValley';

describe('Missouri Valley WSO records page', () => {
  it('reads age headings', () => {
    expect(missouriValleyAge('13 & Under')).toBe('U13');
    expect(missouriValleyAge('age 14 - 15')).toBe('U15');
    expect(missouriValleyAge('Age 18 – 20')).toBe('Junior');
    expect(missouriValleyAge('Age 21 – 34')).toBe('Senior');
    expect(missouriValleyAge('AGE 55 – 59')).toBe('Masters 55');
    expect(missouriValleyAge('49 kg')).toBeNull();
  });

  it('reads age-then-class and class-then-age layouts, wrapped names, typos and empty classes', () => {
    const html = `
      <p>DID YOU BREAK A RECORD?</p><h2>junior</h2><h3>Women</h3><h4>Age 18 – 20</h4>
      <h5>49 kg</h5><p>SNATCH:</p><p>TBD</p><p>CLEAN &amp; JERK:</p><p>70 kg – A Lifter</p><p>TOTAL:</p><p>TBD</p>
      <h3>GIRLS</h3><h4>age 16 - 17</h4><h5>45 kg</h5><p>No Records Set</p>
      <h5>49 kg</h5><p>5NATCH:</p><p>45 kg – Lily York</p><p>CLEAN &amp; JERK:</p><p>59 kg – Lily York</p><p>TOTAL:</p><p>104 kg – Lily York</p>
      <h3>women</h3><h5>49 kg</h5><h4>AGE 55 – 59</h4><p>SNATCH:</p><p>38 kg – Nancy Taylor</p><p>CLEAN &amp; JERK:</p><p>50 kg –<br>Nancy Taylor</p><p>TOTAL:</p><p>88 kg –<br>Nancy Taylor</p>
      <h4>AGE 60 – 64</h4><p>SNATCH:</p><p>35 kg – Joni Siplon</p><p>CLEAN &amp; JERK:</p><p>TBD</p><p>TOTAL:</p><p>TBD</p>
      <h3>men</h3><h5>110+ kg</h5><h4>AGE 35 – 39</h4><p>SNATCH:</p><p>TBD</p><p>CLEAN &amp; JERK:</p><p>TBD</p><p>TOTAL:</p><p>TBD</p>
      <h2>find a club</h2><p>SNATCH:</p><p>1 kg</p>`;
    const rows = parseMissouriValley(missouriValleyLines(html)).map((r) => [r.age_category, r.gender, r.weight_class, r.snatch_record, r.cj_record, r.total_record]);
    expect(rows).toEqual([
      ['Junior', 'Women', '49', null, 70, null],
      ['U17', 'Women', '45', null, null, null],
      ['U17', 'Women', '49', 45, 59, 104],
      ['Masters 55', 'Women', '49', 38, 50, 88],
      ['Masters 60', 'Women', '49', 35, null, null],
      ['Masters 35', 'Men', '110+', null, null, null],
    ]);
  });

  it('names the holder after the dash, including a name wrapped onto the next line', () => {
    const lines = ['women', '49 kg', 'AGE 55 – 59', 'SNATCH:', '38 kg – Nancy Taylor', 'CLEAN & JERK:', '50 kg –', 'Nancy Taylor', 'TOTAL:', 'TBD', '53 kg', 'SNATCH:', '40 kg –', 'CLEAN & JERK:', '45 kg', 'TOTAL:', '85 kg – Brody O’Gara'];
    expect(parseMissouriValley(lines)).toEqual([
      { wso: 'Missouri Valley', age_category: 'Masters 55', gender: 'Women', weight_class: '49', snatch_record: 38, cj_record: 50, total_record: null, snatch_by: { name: 'Nancy Taylor' }, cj_by: { name: 'Nancy Taylor' } },
      {
        wso: 'Missouri Valley',
        age_category: 'Masters 55',
        gender: 'Women',
        weight_class: '53',
        snatch_record: 40,
        cj_record: 45,
        total_record: 85,
        snatch_by: { name: 'Standard' },
        cj_by: { name: 'Standard' },
        total_by: { name: 'Brody O’Gara' },
      },
    ]);
  });

  it('fails on a value it cannot read', () => {
    expect(() => parseMissouriValley(['Women', 'Age 21 – 34', '49 kg', 'SNATCH:', 'pending'])).toThrow('unreadable SNATCH: value "pending"');
  });
});
