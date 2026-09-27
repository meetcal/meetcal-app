import { parseIwfWikitext, wikiText } from '../../convex/scrapers/parse/iwfRecords';

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
    expect(records[0]).toMatchObject({ ageCategory: 'Junior', gender: 'Men', weightClass: '60kg', snatchRecord: 100, cjRecord: 120, totalRecord: 220 });
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

  it('takes each holder from the ratified row, following cells that span rows', () => {
    const header = '!width=8%|Event\n!width=6%|Record\n!width=15%|Athlete\n!width=11%|Nation\n!width=12%|Date\n!width=19%|Meet\n!width=18%|Place\n!width=11%|Age\n!Ref';
    const classes = (c: string) =>
      c === '65'
        ? [
            '|- bgcolor="#DDDDDD"\n! colspan=9|65&nbsp;kg',
            '|-\n|Snatch\n|align=center|152 kg\n|rowspan=3|[[He Yueji]]\n|rowspan=3|{{flagu|China}}\n|24 September 2026\n|[[Weightlifting at the 2026 Asian Games – Men\'s 65 kg|Asian Games]]\n|[[Nagoya]], Japan\n|{{Age in years and days|2004|1|1|2026|9|24}}\n|<ref>{{cite web|title=Results|url=https://example.org}}</ref>',
            '|-\n|Clean & Jerk\n|align=center|183 kg\n|rowspan=2|13 May 2026\n|rowspan=2|[[2026 Asian Weightlifting Championships|Asian Championships]]\n|rowspan=2|[[Gandhinagar]], India\n|rowspan=2|\n|rowspan=2|<ref name="AS2026" />',
            '|-\n|Total\n|align=center|329 kg',
          ].join('\n')
        : c === '85'
          ? `|- bgcolor="#DDDDDD"\n! colspan=9|85&nbsp;kg\n|-\n|rowspan=2|Snatch\n|align=center|164&nbsp;kg\n|''World Standard''\n|\n|\n|\n|\n|\n|\n|-bgcolor=#CEF6F5\n|align=center|166 kg\n|[[Ángel Rodríguez (weightlifter)|Ángel Rodríguez]]\n|{{flagu|Venezuela}}\n|29 August 2026\n|South American Junior Championships\n|[[Guayaquil]], Ecuador\n${lift('Clean & Jerk', '200 kg', "|[[K'Duong]]\n|{{flagu|Vietnam}}\n|13 December 2025\n|[[Weightlifting at the 2025 SEA Games|SEA Games]]\n|[[Chonburi]], Thailand")}\n${lift('Total', '360 kg')}`
          : undefined;
    const records = parseIwfWikitext(page(`${header}\n${table(MEN, classes)}`), 'Junior');
    const light = records.find((r) => r.weightClass === '65kg');
    expect(light?.snatchBy).toEqual({ name: 'He Yueji', date: '2026-09-24', location: 'Asian Games, Nagoya, Japan' });
    expect(light?.cjBy).toEqual({ name: 'He Yueji', date: '2026-05-13', location: 'Asian Championships, Gandhinagar, India' });
    expect(light?.totalBy).toEqual(light?.cjBy);
    const middle = records.find((r) => r.weightClass === '85kg');
    // The standard is the ratified row; the 166 kg awaiting ratification is not its holder.
    expect(middle).toMatchObject({ snatchRecord: 164, snatchBy: { name: 'Standard' } });
    expect(middle?.snatchBy).toEqual({ name: 'Standard' });
    expect(middle?.cjBy).toEqual({ name: "K'Duong", date: '2025-12-13', location: 'SEA Games, Chonburi, Thailand' });
    expect(middle?.totalBy).toEqual({ name: 'Someone', date: '2026-05-01' });
    // A blank athlete with a value is a standard too.
    expect(records.find((r) => r.weightClass === '60kg')?.totalBy).toEqual({ name: 'Standard' });
  });

  it('reads wiki markup as displayed', () => {
    expect(wikiText("[[Førde (town)|Førde]], Norway")).toBe('Førde, Norway');
    expect(wikiText("''World Standard''")).toBe('World Standard');
    expect(wikiText('{{flagu|Norway}}')).toBe('');
    expect(wikiText('[[Pang Un-chol]]<ref name="AS2026">{{cite web|title=Result Book|url=https://x}}</ref>')).toBe('Pang Un-chol');
    expect(wikiText('{{nowrap|13 December 2025}}')).toBe('13 December 2025');
  });

  it('fails rather than replace the records when the table changes shape', () => {
    expect(() => parseIwfWikitext(page(table(MEN.slice(0, 7))), 'Senior')).toThrow('7 weight classes, expected 8');
    const noTotal = (c: string) => (c === '60' ? `|- bgcolor="#DDDDDD"\n! colspan=9|60&nbsp;kg\n${lift('Snatch', '100 kg')}\n${lift('Clean & Jerk', '120 kg')}` : undefined);
    expect(() => parseIwfWikitext(page(table(MEN, noTotal)), 'Senior')).toThrow('Senior Men 60kg: missing a lift');
    expect(() => parseIwfWikitext('==Other==\n', 'Senior')).toThrow('no "Current records" section');
  });
});
