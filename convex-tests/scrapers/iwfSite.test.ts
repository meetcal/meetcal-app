import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHtml } from '../../convex/scrapers/lib/html';
import { iwfSiteUrl, parseIwfSiteHtml } from '../../convex/scrapers/parse/iwfSite';

// iwf.sport's senior women's page as Browserless loaded it on 28 October
// 2026, cut to its records list.
const page = readFileSync(join(__dirname, 'fixtures/iwf-world-records-senior-women-20261028.html'), 'utf8');

describe('IWF world records from iwf.sport', () => {
  it('reads eight classes with all three lifts and who holds each', () => {
    const records = parseIwfSiteHtml(page, 'Senior', 'Women');
    expect(records.map((r) => r.weightClass)).toEqual(['49kg', '53kg', '57kg', '61kg', '69kg', '77kg', '86kg', '+86kg']);
    expect(records[0]).toEqual({
      ageCategory: 'Senior',
      gender: 'Women',
      weightClass: '49kg',
      snatchRecord: 94,
      cjRecord: 121,
      totalRecord: 215,
      snatchBy: { name: 'RI Song Gum', date: '2026-09-23', location: 'Aichi-Nagoya' },
      cjBy: { name: 'RI Song Gum', date: '2026-09-23', location: 'Aichi-Nagoya' },
      totalBy: { name: 'RI Song Gum', date: '2026-09-23', location: 'Aichi-Nagoya' },
    });
    // Lifts of one class held by different athletes.
    expect(records[3]).toMatchObject({ snatchBy: { name: 'YANG Liuyue' }, cjBy: { name: 'PAK Jin Hae' }, totalBy: { name: 'YANG Liuyue' } });
  });

  it('gives an unclaimed standard no date or place, as the Wikipedia lists do', () => {
    const records = parseIwfSiteHtml(page, 'Senior', 'Women');
    expect(records[1]).toMatchObject({ weightClass: '53kg', snatchRecord: 99, snatchBy: { name: 'Standard' }, cjBy: { name: 'Standard' }, totalBy: { name: 'Standard' } });
    expect(records[7]).toMatchObject({
      weightClass: '+86kg',
      snatchRecord: 145,
      snatchBy: { name: 'LI Yan', date: '2026-05-17', location: 'Gandhinagar' },
      cjRecord: 181,
      cjBy: { name: 'Standard' },
    });
  });

  it('fails on the bot challenge, a missing class or a missing lift instead of reading too few records', () => {
    expect(() => parseIwfSiteHtml('<html><head><title>Just a moment...</title></head></html>', 'Senior', 'Women')).toThrow('no records list');
    const without = (...selectors: string[]) => {
      const root = parseHtml(page);
      for (const selector of selectors) root.querySelectorAll(selector).at(-1)?.remove();
      return root.toString();
    };
    expect(() => parseIwfSiteHtml(without('.results__title', '.cards'), 'Senior', 'Women')).toThrow('7 weight classes, expected 8');
    // A heading lost on its own leaves its lifts under the class before.
    expect(() => parseIwfSiteHtml(without('.results__title'), 'Senior', 'Women')).toThrow('86kg: Snatch listed twice');
    expect(() => parseIwfSiteHtml(without('.cards > .card'), 'Senior', 'Women')).toThrow('+86kg: missing a lift');
  });

  it('asks for the current records of one age group and gender', () => {
    expect(iwfSiteUrl('Youth', 'Women')).toBe('https://iwf.sport/results/world-records/?ranking_curprog=current&ranking_agegroup=Youth&ranking_gender=w');
    expect(iwfSiteUrl('Senior', 'Men')).toContain('ranking_agegroup=Senior&ranking_gender=m');
  });
});
