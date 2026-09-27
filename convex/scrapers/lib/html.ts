import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Parses a page the way BeautifulSoup reads it for `get_text()`: the contents
 * of `<style>`, `<script>` and `<noscript>` are dropped, so an element's
 * `.text` is only its visible text. (The site inlines `<style>` inside links,
 * which otherwise turns a "View" button's text into CSS followed by "View".)
 */
export function parseHtml(html: string): HTMLElement {
  return parse(html, { blockTextElements: { script: false, noscript: false, style: false, pre: true } });
}

export type { HTMLElement };

/** Python's `html.unescape` for the entities these pages use (numeric and the XML five). */
export function unescapeHtml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&');
}
