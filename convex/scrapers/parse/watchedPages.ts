import { parseHtml, unescapeHtml } from '../lib/html';

// The pages urlwatch followed (its `urls.yaml`): each page's selected
// elements reduced to text the way urlwatch's `css` then `html2text` (method
// `re`) filters did: block elements on their own lines, tags stripped, blank
// lines dropped, trailing space trimmed. Unlike urlwatch, entities are decoded and script/style contents
// dropped, so the emailed diffs read as the page does.

/**
 * `pdfLinks`: also list the PDFs the selected elements link to, one
 * `PDF: <url>` line each, so a document replaced under the same wording (a
 * new qualifying totals PDF) shows in the diff.
 */
export type WatchedPage = { name: string; url: string; selector: string; pdfLinks?: boolean };

export const WATCHED_PAGES: WatchedPage[] = [
  { name: 'USA Masters Weightlifting Results', url: 'https://usamasters.net/results', selector: '.kv-ee-content' },
  { name: 'USA Masters Weightlifting Qualifying Totals', url: 'https://usamasters.net/qualifying-totals', selector: '.kv-ee-row.kv-ee-position' },
  { name: 'USA Masters Weightlifting Events', url: 'https://usamasters.net/events', selector: '.kv-ee-content' },
  { name: 'USA Masters Weightlifting Records', url: 'https://usamasters.net/masters-records-grand-slam', selector: '.kv-ee-row.kv-ee-position' },
  // The national event qualifying totals are loaded by hand
  // (`ingest:replaceQualifyingTotalSet`): a new or replaced PDF here is the
  // cue to load it (#407).
  {
    name: 'USA Weightlifting 2026 National Event Qualifying Totals',
    url: 'https://www.usaweightlifting.org/2026-usa-weightlifting-national-event-qualifying-totals',
    selector: '.content-tile-block',
    pdfLinks: true,
  },
  {
    name: 'USA Weightlifting 2027 National Event Qualifying Totals',
    url: 'https://www.usaweightlifting.org/2027-USA-Weightlifting-National-Event-Qualifying-Totals',
    selector: '.content-tile-block',
    pdfLinks: true,
  },
];

/** The text of a page's selected elements (then their PDF links, with `pdfLinks`); empty when the selector matches nothing. */
export function pageText(html: string, selector: string, options: { pdfLinks?: boolean } = {}): string {
  const elements = parseHtml(html).querySelectorAll(selector);
  // Each element's own source (not a re-serialisation, which loses line breaks).
  const selected = elements.map((element) => html.slice(element.range[0], element.range[1])).join('\n');
  const pdfs = options.pdfLinks
    ? [
        ...new Set(
          elements.flatMap((element) =>
            element
              .querySelectorAll('a[href]')
              .map((link) => unescapeHtml(link.getAttribute('href') ?? '').trim())
              .filter((href) => /\.pdf(?:[?#]|$)/i.test(href)),
          ),
        ),
      ].map((href) => `PDF: ${href}`)
    : [];
  const visible = selected.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '');
  // Block elements on lines of their own, as urlwatch's pretty-printed selection had them.
  const blocks = visible.replace(/<\/?(?:div|p|h[1-6]|li|ul|ol|table|tr|section|article|header|footer|br)\b[^>]*>/gi, '\n$&\n');
  return [
    ...unescapeHtml(blocks.replace(/<[^>]*>/g, ''))
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => line.trimEnd()),
    ...pdfs,
  ].join('\n');
}
