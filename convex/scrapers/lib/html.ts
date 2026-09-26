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
