import { getDocumentProxy } from 'unpdf';

export type PdfLineOptions = {
  /** Baselines this close (points) are one line; pdfplumber's `y_tolerance`, default 3. */
  yTolerance?: number;
  /** Runs further apart than this (points) get a space between them; pdfplumber's `x_tolerance`, default 3. */
  xTolerance?: number;
  /**
   * Place text where a rotated page (`/Rotate`) displays it, rather than in
   * the page's own coordinates. The September 2026 USAMW national records
   * PDFs rotate their pages and draw the text turned, so read in the page's
   * coordinates each table column comes out as a line. Off by default: the
   * other sources were checked against the page's own coordinates.
   */
  asDisplayed?: boolean;
};

/** A piece of text the PDF drew, with where it starts and ends across the page (points). */
export type PdfRun = { text: string; x: number; end: number };

/** One line of a page: its runs left to right, and their text joined as `pdfLines` joins it. */
export type PdfLine = { text: string; runs: PdfRun[] };

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof getDocumentProxy>>['getPage']>>;

/**
 * Where a run lies on the page (x rightward, y upward), from its text
 * transform and width: as the page is displayed when `asDisplayed` and the
 * page is rotated, through its display transform; in the page's own
 * coordinates otherwise. Turned, a run is placed by both its ends, since its
 * text may now run right to left.
 */
function runPlacer(page: PdfPage, asDisplayed: boolean): (transform: number[], width: number) => { x: number; y: number; end: number } {
  const placed = ([scaleX = 1, skewY = 0, , , x = 0, y = 0]: number[]) => ({ scaleX, skewY, x, y });
  if (!asDisplayed || page.rotate % 360 === 0) {
    return (t, width) => {
      const { x, y } = placed(t);
      return { x, y, end: x + width };
    };
  }
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = page.getViewport({ scale: 1 }).transform;
  // The display transform's y runs downward; negate it so lines still sort top first by descending y.
  const display = (x: number, y: number) => ({ x: a * x + c * y + e, y: -(b * x + d * y + f) });
  return (t, width) => {
    const run = placed(t);
    const scale = Math.hypot(run.scaleX, run.skewY) || 1;
    const start = display(run.x, run.y);
    const finish = display(run.x + (width * run.scaleX) / scale, run.y + (width * run.skewY) / scale);
    return { x: Math.min(start.x, finish.x), y: start.y, end: Math.max(start.x, finish.x) };
  };
}

/**
 * A PDF's lines, page by page, laid out like pdfplumber's `extract_text`:
 * text runs grouped by baseline (top to bottom), each line left to right,
 * runs joined with a space only where there is a gap wider than
 * `xTolerance`, so a number the PDF drew in two runs stays one word. Runs
 * keep their positions, for reading a table by its columns.
 */
export async function pdfRunLines(bytes: Uint8Array, options: PdfLineOptions = {}): Promise<PdfLine[][]> {
  const yTolerance = options.yTolerance ?? 3;
  const xTolerance = options.xTolerance ?? 3;
  const pdf = await getDocumentProxy(bytes);
  const pages: PdfLine[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const place = runPlacer(page, options.asDisplayed ?? false);
    const runs = content.items
      .filter((item): item is typeof item & { str: string; transform: number[]; width: number } => 'str' in item)
      .map((item) => ({ text: item.str, ...place(item.transform, item.width ?? 0) }))
      .filter((run) => run.text.trim().length > 0);
    runs.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: { y: number; runs: typeof runs }[] = [];
    for (const run of runs) {
      const line = lines.find((l) => Math.abs(l.y - run.y) <= yTolerance);
      if (line) line.runs.push(run);
      else lines.push({ y: run.y, runs: [run] });
    }
    pages.push(
      lines
        .sort((a, b) => b.y - a.y)
        .map((line) => {
          line.runs.sort((a, b) => a.x - b.x);
          let text = '';
          let end = -Infinity;
          for (const run of line.runs) {
            if (text && run.x - end > xTolerance) text += ' ';
            text += run.text;
            end = Math.max(end, run.end);
          }
          return { text: text.replace(/\s+/g, ' ').trim(), runs: line.runs.map((run) => ({ text: run.text, x: run.x, end: run.end })) };
        }),
    );
  }
  return pages;
}

/** A PDF's text, page by page, line by line (see `pdfRunLines`). */
export async function pdfLines(bytes: Uint8Array, options: PdfLineOptions = {}): Promise<string[][]> {
  return (await pdfRunLines(bytes, options)).map((page) => page.map((line) => line.text));
}
