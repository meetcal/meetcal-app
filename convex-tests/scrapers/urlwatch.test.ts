import { unifiedDiff } from '../../convex/scrapers/lib/diff';
import { pageText } from '../../convex/scrapers/parse/watchedPages';

describe('urlwatch', () => {
  it("reduces a page to its selected elements' text, a block per line", () => {
    const html = `<html><body><div class="nav">Home</div>
      <div class="kv-ee-content"><h3>2027 National Masters<span style="display:none;"></span></h3><p>April 21-25, 2027<br>Memphis, TN</p>
      <script>var x = 1;</script><style>.a{}</style></div>
      <div class="kv-ee-content"><p>Tom &amp; Jerry&#39;s   </p></div></body></html>`;
    expect(pageText(html, '.kv-ee-content')).toBe("2027 National Masters\nApril 21-25, 2027\nMemphis, TN\nTom & Jerry's");
    expect(pageText(html, '.missing')).toBe('');
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
