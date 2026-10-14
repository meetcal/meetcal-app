import { unifiedDiff } from '../../convex/scrapers/lib/diff';
import { pageText, WATCHED_PAGES } from '../../convex/scrapers/parse/watchedPages';

describe('urlwatch', () => {
  it("reduces a page to its selected elements' text, a block per line", () => {
    const html = `<html><body><div class="nav">Home</div>
      <div class="kv-ee-content"><h3>2027 National Masters<span style="display:none;"></span></h3><p>April 21-25, 2027<br>Memphis, TN</p>
      <script>var x = 1;</script><style>.a{}</style></div>
      <div class="kv-ee-content"><p>Tom &amp; Jerry&#39;s   </p></div></body></html>`;
    expect(pageText(html, '.kv-ee-content')).toBe("2027 National Masters\nApril 21-25, 2027\nMemphis, TN\nTom & Jerry's");
    expect(pageText(html, '.missing')).toBe('');
  });

  it('lists the PDFs a page links to, so a replaced qualifying totals PDF shows in the diff (#407)', () => {
    const html = `<div class="nav"><a href="/nav.pdf">Nav</a></div>
      <div class="content-tile-block"><h2>2027 Qualifying Totals</h2><p>Click here to view qualifying totals.</p>
      <a href="https://cdn.test/2027_-_Qualifying_Totals.pdf"><span>View</span></a>
      <a href="https://cdn.test/2027_-_Qualifying_Totals.pdf">View again</a><a href="/calendar">View Calendar</a>
      <a href="https://cdn.test/a&amp;b.PDF?v=2">Other</a></div>`;
    const lines = pageText(html, '.content-tile-block', { pdfLinks: true }).split('\n');
    expect(lines.slice(0, 2)).toEqual(['2027 Qualifying Totals', 'Click here to view qualifying totals.']);
    // After the text, once each, the selection's PDFs only (not the nav's, not other links).
    expect(lines.slice(-2)).toEqual(['PDF: https://cdn.test/2027_-_Qualifying_Totals.pdf', 'PDF: https://cdn.test/a&b.PDF?v=2']);
    expect(lines.filter((line) => line.startsWith('PDF:'))).toHaveLength(2);
    // Pages watched without it read as before.
    expect(pageText(html, '.content-tile-block')).not.toContain('PDF:');
    expect(WATCHED_PAGES.filter((page) => page.url.includes('usaweightlifting.org')).map((page) => page.pdfLinks)).toEqual([true, true]);
  });

  it('diffs line by line with three lines of context, removals first', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
    const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].join('\n');
    // Six unchanged lines between the changes still make one hunk, as in diff(1).
    expect(unifiedDiff(before, after)).toBe(['@@ -1,10 +1,11 @@', ' a', ' b', ' c', '-d', '+D', ' e', ' f', ' g', ' h', ' i', ' j', '+k'].join('\n'));
    const far = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'l', 'm'].join('\n');
    expect(unifiedDiff(far, far.replace('a', 'A').replace('m', 'M'))).toBe(['@@ -1,4 +1,4 @@', '-a', '+A', ' b', ' c', ' d', '@@ -9,4 +9,4 @@', ' i', ' j', ' l', '-m', '+M'].join('\n'));
    expect(unifiedDiff(before, before)).toBe('');
  });
});
