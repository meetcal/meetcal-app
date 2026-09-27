import { parseHtml, unescapeHtml } from '../lib/html';

// The pages urlwatch followed (its `urls.yaml`): each page's selected
// elements reduced to text the way urlwatch's `css` then `html2text` (method
// `re`) filters did: block elements on their own lines, tags stripped, blank
// lines dropped, trailing space trimmed. Unlike urlwatch, entities are decoded and script/style contents
// dropped, so the Slack diffs read as the page does.

export type WatchedPage = { name: string; url: string; selector: string };

export const WATCHED_PAGES: WatchedPage[] = [
  { name: 'USA Masters Weightlifting Results', url: 'https://usamasters.net/results', selector: '.kv-ee-content' },
  { name: 'USA Masters Weightlifting Qualifying Totals', url: 'https://usamasters.net/qualifying-totals', selector: '.kv-ee-row.kv-ee-position' },
  { name: 'USA Masters Weightlifting Events', url: 'https://usamasters.net/events', selector: '.kv-ee-content' },
  { name: 'USA Masters Weightlifting Records', url: 'https://usamasters.net/masters-records-grand-slam', selector: '.kv-ee-row.kv-ee-position' },
];

/** The text of a page's selected elements; empty when the selector matches nothing. */
export function pageText(html: string, selector: string): string {
  // Each element's own source (not a re-serialisation, which loses line breaks).
  const selected = parseHtml(html)
    .querySelectorAll(selector)
    .map((element) => html.slice(element.range[0], element.range[1]))
    .join('\n');
  const visible = selected.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '');
  // Block elements on lines of their own, as urlwatch's pretty-printed selection had them.
  const blocks = visible.replace(/<\/?(?:div|p|h[1-6]|li|ul|ol|table|tr|section|article|header|footer|br)\b[^>]*>/gi, '\n$&\n');
  return unescapeHtml(blocks.replace(/<[^>]*>/g, ''))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.trimEnd())
    .join('\n');
}
