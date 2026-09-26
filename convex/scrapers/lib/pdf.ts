import { getDocumentProxy } from 'unpdf';

/**
 * A PDF's text, page by page, line by line: text items grouped by baseline
 * (top to bottom), each line's items left to right and joined by single
 * spaces. The layout pdfplumber's `extract_text` gives the Python scrapers,
 * which is all their table parsing reads.
 */
export async function pdfLines(bytes: Uint8Array): Promise<string[][]> {
  const pdf = await getDocumentProxy(bytes);
  const pages: string[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item)
      .map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5] }))
      .filter((item) => item.text.trim().length > 0);
    // Baselines within a couple of points are one line (pdfplumber's default tolerance is 3).
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: { y: number; items: typeof items }[] = [];
    for (const item of items) {
      const line = lines.find((l) => Math.abs(l.y - item.y) <= 3);
      if (line) line.items.push(item);
      else lines.push({ y: item.y, items: [item] });
    }
    pages.push(
      lines
        .sort((a, b) => b.y - a.y)
        .map((line) =>
          line.items
            .sort((a, b) => a.x - b.x)
            .map((item) => item.text.trim())
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
        ),
    );
  }
  return pages;
}

