import { discoverRankingPdfs, inferMeetInfo, parseMeetInfo, parseRankingsTable } from '../../convex/scrapers/parse/intlRankings';

describe('international rankings (port of intl_rankings_scraper.py)', () => {
  it('finds View-button PDFs in the embedded card JSON with their nearest titles, once each', () => {
    const page =
      '{"title":"2026 Senior World Championships - Women","x":1,"button_options":{"button_text":"View","url":"https://cdn.example/a/Women_Rankings.pdf"}}' +
      '{"title":"Junior Pan Am &amp; more - Men","button_options":{"button_text":"View","url":"https://cdn.example/b/Jr_Men.pdf"}}' +
      '{"button_options":{"button_text":"View","url":"https://cdn.example/a/Women_Rankings.pdf"}}';
    expect(discoverRankingPdfs(page)).toEqual([
      { title: '2026 Senior World Championships - Women', url: 'https://cdn.example/a/Women_Rankings.pdf' },
      { title: 'Junior Pan Am & more - Men', url: 'https://cdn.example/b/Jr_Men.pdf' },
    ]);
  });

  it('infers meet, gender and age from the card title, then the PDF text', () => {
    expect(inferMeetInfo('2027 Senior Pan American Championships - Women')).toEqual({ meet_name: 'Pan Ams', gender: 'Women', age_category: 'Senior' });
    expect(inferMeetInfo('2026 FISU University Worlds - Men')).toEqual({ meet_name: 'Worlds', gender: 'Men', age_category: 'University' });
    // An Olympic qualifier names no age group anywhere: the group cannot be stored.
    expect(parseMeetInfo(['2026 Olympic Qualifier #1 Rankings'], '2026 Olympic Qualifier #1 - Men', 'https://x/OQ.pdf')).toEqual({
      meet_name: 'Worlds',
      gender: 'Men',
      age_category: '',
    });
    expect(parseMeetInfo(['U17 Pan American Championships Rankings'], 'Rankings', 'https://x/r.pdf')).toEqual({
      meet_name: 'Pan Ams',
      gender: '',
      age_category: 'U17',
    });
  });

  it('reads ranking rows after the header until the standards table', () => {
    const info = { meet_name: 'Worlds', gender: 'Women', age_category: 'Senior' };
    const lines = ['Rankings', 'Rank Athlete Name Body Weight Total % of A', '1 Mary Jane Doe 71 248 104.64%', 'footnote', '2 Ann Roe 87+ 1,250 99.2%', 'A Standard', '3 After Table 60 200 90%'];
    expect(parseRankingsTable(lines, info)).toEqual([
      { meet: 'Worlds', ranking: 1, name: 'Mary Jane Doe', weight_class: '71', total: 248, percent_a: 104.64, gender: 'Women', age_category: 'Senior' },
    ]);
    expect(parseRankingsTable(['no header here', '1 A B 71 200 99%'], info)).toEqual([]);
  });
});
