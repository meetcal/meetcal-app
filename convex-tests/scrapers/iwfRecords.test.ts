import { parseIwfWikitext } from '../../convex/scrapers/parse/iwfRecords';

function lift(name: string, value: string, extra = '|[[Someone]]\n|{{flagu|China}}\n|1 May 2026') {
  return `|-\n|${name}\n|align=center|${value}\n${extra}`;
}

function table(classes: string[], quirk?: (weightClass: string) => string | undefined) {
  return classes
    .map((c, i) => {
      const header = `|- bgcolor="#DDDDDD"\n! ${i === 0 ? 'colspan="9"' : 'colspan=9'}|${c}&nbsp;kg`;
      return quirk?.(c) ?? `${header}\n${lift('Snatch', '100&nbsp;kg')}\n${lift('Clean & Jerk', '120 kg')}\n${lift('Total', '220&nbsp;kg', "|''World Standard''")}`;
    })
    .join('\n');
}

const MEN = ['60', '65', '70', '75', '85', '95', '110', '+110'];
const WOMEN = ['49', '53', '57', '61', '69', '77', '86', '+86'];

const page = (men: string, women = table(WOMEN)) => `==Current records==\n'''Key to tables''':\n{{legend2|#CEF6F5|''Awaiting ratification''}}\n\n===Men===\n{| class="wikitable"\n${men}\n|}\n\n===Women===\n{| class="wikitable"\n${women}\n|}\n`;

describe('IWF world records from Wikipedia', () => {
  it('reads eight classes per gender with all three lifts', () => {
    const records = parseIwfWikitext(page(table(MEN)), 'Junior');
    expect(records).toHaveLength(16);
    expect(records[0]).toEqual({ ageCategory: 'Junior', gender: 'Men', weightClass: '60kg', snatchRecord: 100, cjRecord: 120, totalRecord: 220 });
    expect(records[7].weightClass).toBe('+110kg');
    expect(records[15]).toMatchObject({ gender: 'Women', weightClass: '+86kg' });
  });

  it('keeps the ratified record when a lift has one awaiting ratification', () => {
    const pending = (c: string) =>
      c === '85'
        ? `|- bgcolor="#DDDDDD"\n! colspan=9|85&nbsp;kg\n|-\n|rowspan=2|Snatch\n|align=center|164&nbsp;kg\n|''World Standard''\n|-bgcolor=#CEF6F5\n|align=center|166&nbsp;kg\n|[[Someone]]\n${lift('Clean & Jerk', '200 kg')}\n${lift('Total', '360 kg')}`
        : undefined;
    const records = parseIwfWikitext(page(table(MEN, pending)), 'Junior');
    expect(records.find((r) => r.weightClass === '85kg')).toMatchObject({ snatchRecord: 164, cjRecord: 200, totalRecord: 360 });
  });

  it('fails rather than replace the records when the table changes shape', () => {
    expect(() => parseIwfWikitext(page(table(MEN.slice(0, 7))), 'Senior')).toThrow('7 weight classes, expected 8');
    const noTotal = (c: string) => (c === '60' ? `|- bgcolor="#DDDDDD"\n! colspan=9|60&nbsp;kg\n${lift('Snatch', '100 kg')}\n${lift('Clean & Jerk', '120 kg')}` : undefined);
    expect(() => parseIwfWikitext(page(table(MEN, noTotal)), 'Senior')).toThrow('Senior Men 60kg: missing a lift');
    expect(() => parseIwfWikitext('==Other==\n', 'Senior')).toThrow('no "Current records" section');
  });
});
