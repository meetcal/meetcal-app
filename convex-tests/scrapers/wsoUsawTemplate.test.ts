import { parseUsawTemplate } from '../../convex/scrapers/parse/wso/usawTemplate';

describe('WSO sheets in the USAW record template (Minnesota-Dakotas, Texas-Oklahoma)', () => {
  it('reads Minnesota-Dakotas rows, whose claimed records run past the headers', () => {
    const csv = [
      'federation,recordName,ageGroup,gender,ageMin,ageMax,bodyWeightMin,bodyWeightMax,lift,record,name,date,place,event,,,',
      'Minnesota-Dakotas,Minnesota-Dakotas,U13,F,0,13,0,36,Snatch,26,"MONGEON, Navia",2016-12-07,Lakeville South Strength,2026-06-20,"Colorado Springs, CO",2 RED,2026 USAW National Championships',
      'Minnesota-Dakotas,Minnesota-Dakotas,U13,F,0,13,63,>63,Total,90,STANDARD,2025-06-01,,,,,',
      'Minnesota-Dakotas,Minnesota-Dakotas,W35 ADAP,F,35,39,0,48,Total,50,STANDARD,2025-06-01,,,,,',
    ].join('\n');
    expect(parseUsawTemplate(csv, 'Minnesota-Dakotas').records).toEqual([
      {
        wso: 'Minnesota-Dakotas',
        age_category: 'U13',
        gender: 'Women',
        weight_class: '36',
        snatch_record: 26,
        cj_record: null,
        total_record: null,
        snatch_by: { name: 'MONGEON, Navia', date: '2026-06-20', location: '2026 USAW National Championships, Colorado Springs, CO' },
      },
      {
        wso: 'Minnesota-Dakotas',
        age_category: 'U13',
        gender: 'Women',
        weight_class: '63+',
        snatch_record: null,
        cj_record: null,
        total_record: 90,
        total_by: { name: 'Standard', date: '2025-06-01' },
      },
    ]);
  });

  it("reads Texas-Oklahoma's Detailed tab, 0 meaning no record", () => {
    const csv = [
      '"WSO","recordName","Current as of:  09/23/2026 Age Group","Gender","ageMin","ageMax","bodyWeightMin","Weight Class","Lift","Record","Name","Born","Club","Date","Place","Group","Event",""',
      '"Texas-Oklahoma","TX-OK","M40","M","40","44","110","","CLEANJERK","150","DOE, John","1984-01-01","Club","2026-06-20","Colorado Springs, CO","","Nationals",""',
      '"Texas-Oklahoma","TX-OK","U11","F","0","11","30","33","SNATCH","0","STANDARD","","","2026-08-01","","","",""',
    ].join('\n');
    expect(parseUsawTemplate(csv, 'Texas-Oklahoma').records).toEqual([
      {
        wso: 'Texas-Oklahoma',
        age_category: 'Masters 40',
        gender: 'Men',
        weight_class: '110+',
        snatch_record: null,
        cj_record: 150,
        total_record: null,
        cj_by: { name: 'DOE, John', date: '2026-06-20', location: 'Nationals, Colorado Springs, CO' },
      },
      { wso: 'Texas-Oklahoma', age_category: 'U11', gender: 'Women', weight_class: '33', snatch_record: null, cj_record: null, total_record: null },
    ]);
  });

  it("reads Texas-Oklahoma's 999 maximum as the open class from the minimum", () => {
    const header = '"WSO","recordName","Current as of:  10/2/2026 Age Group","Gender","ageMin","ageMax","bodyWeightMin","Weight Class","Lift","Record","Name","Born","Club","Date","Place","Group","Event",""';
    const row = (min: string, max: string, lift: string, record: string) => `"Texas-Oklahoma","TX-OK","JR","M","15","20","${min}","${max}","${lift}","${record}","STANDARD","","","2026-08-01","","","",""`;
    const { records, warnings } = parseUsawTemplate([header, row('95', '110', 'SNATCH', '150'), row('110', '999', 'SNATCH', '160'), row('110', '999', 'TOTAL', '360')].join('\n'), 'Texas-Oklahoma');
    expect(records.map((r) => [r.weight_class, r.snatch_record, r.total_record])).toEqual([
      ['110', 150, null],
      ['110+', 160, 360],
    ]);
    expect(warnings).toEqual([]);
  });

  it("names a class by the sheet's weight ladder where its rows disagree on the maximum", () => {
    const header = 'federation,recordName,ageGroup,gender,ageMin,ageMax,bodyWeightMin,bodyWeightMax,lift,record,name,date,place,event,,,';
    const row = (min: string, max: string, lift: string, record: string) => `Minnesota-Dakotas,Minnesota-Dakotas,JR,F,15,20,${min},${max},${lift},${record},STANDARD,2025-06-01,,,,,`;
    // The sheet's Junior Women 69-77, its snatch written 69-65 and its total 69-140.
    const lines = [header, row('63', '69', 'Total', '150'), row('69', '65', 'Snatch', '71'), row('69', '77', 'Clean & Jerk', '86'), row('69', '140', 'Total', '157'), row('77', '86', 'Total', '170'), row('86', '>86', 'Total', '180')];
    const { records, warnings } = parseUsawTemplate(lines.join('\n'), 'Minnesota-Dakotas');
    expect(records.map((r) => r.weight_class)).toEqual(['69', '77', '86', '86+']);
    expect(records[1]).toMatchObject({ weight_class: '77', snatch_record: 71, cj_record: 86, total_record: 157 });
    expect(warnings).toEqual(['Minnesota-Dakotas Junior Women from 69 kg: the sheet names it 65, 77, 140; stored as 77']);
    // Rows that agree on a maximum at or below their minimum; at the top of the ladder, the open class.
    const agreeingWrong = parseUsawTemplate([header, row('69', '65', 'Snatch', '71'), row('69', '65', 'Total', '157'), row('77', '86', 'Total', '170')].join('\n'), 'Minnesota-Dakotas');
    expect(agreeingWrong.records.map((r) => r.weight_class)).toEqual(['77', '86']);
    const top = parseUsawTemplate([header, row('77', '86', 'Total', '170'), row('86', '80', 'Total', '180')].join('\n'), 'Minnesota-Dakotas');
    expect(top.records.map((r) => r.weight_class)).toEqual(['86', '86+']);
    expect(top.warnings).toEqual(['Minnesota-Dakotas Junior Women from 86 kg: the sheet names it 80; stored as 86+']);
  });
});
