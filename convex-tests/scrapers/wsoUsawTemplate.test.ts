import { parseUsawTemplate } from '../../convex/scrapers/parse/wso/usawTemplate';

describe('WSO sheets in the USAW record template (Minnesota-Dakotas, Texas-Oklahoma)', () => {
  it('reads Minnesota-Dakotas rows, whose claimed records run past the headers', () => {
    const csv = [
      'federation,recordName,ageGroup,gender,ageMin,ageMax,bodyWeightMin,bodyWeightMax,lift,record,name,date,place,event,,,',
      'Minnesota-Dakotas,Minnesota-Dakotas,U13,F,0,13,0,36,Snatch,26,"MONGEON, Navia",2016-12-07,Lakeville South Strength,2026-06-20,"Colorado Springs, CO",2 RED,2026 USAW National Championships',
      'Minnesota-Dakotas,Minnesota-Dakotas,U13,F,0,13,63,>63,Total,90,STANDARD,2025-06-01,,,,,',
      'Minnesota-Dakotas,Minnesota-Dakotas,W35 ADAP,F,35,39,0,48,Total,50,STANDARD,2025-06-01,,,,,',
    ].join('\n');
    expect(parseUsawTemplate(csv, 'Minnesota-Dakotas')).toEqual([
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
    expect(parseUsawTemplate(csv, 'Texas-Oklahoma')).toEqual([
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
});
