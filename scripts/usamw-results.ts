/**
 * Loads a USA Masters meet's results from its result PDFs into Convex
 * (replaces `usamw/results/usamw_results.py`, which the /usamw-results Slack
 * command queued). Run it by hand:
 *
 *   bun scripts/usamw-results.ts --meet "2026 Elite Invitational" --date 2026-07-09 \
 *     --pdf https://drive.google.com/file/d/…/view --pdf https://… [--adaptive] [--dry-run] [--prod]
 *
 * PDFs may be Google Drive links. `--dry-run` prints what would be written;
 * `--prod` writes to the production deployment (otherwise the dev one).
 * Rows are upserted on (event, meet, name), so a re-run updates in place.
 */
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import * as mupdf from 'mupdf';
import { parseUsamwResults, type PdfWord, type UsamwResult } from '../convex/scrapers/parse/usamwResults';

const TIMEOUT_MS = 45_000;

/** A Drive share link's file id, if it is one. */
function driveFileId(url: string): string | null {
  return /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(url)?.[1] ?? new URL(url).searchParams.get('id');
}

export async function fetchPdf(url: string): Promise<Uint8Array> {
  const id = driveFileId(url);
  const download = id ? `https://drive.google.com/uc?export=download&id=${id}` : url;
  let response = await fetch(download, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  // Large Drive files answer with a "can't scan for viruses" page first.
  if (id && (response.headers.get('content-type') ?? '').includes('text/html')) {
    const confirm = /confirm=([^&"']+)/.exec(await response.text())?.[1];
    if (!confirm) throw new Error(`Google Drive did not return a PDF for ${url}`);
    response = await fetch(`${download}&confirm=${confirm}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  }
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const isRed = (color: number[] | undefined) => {
  if (!color || color.length < 3) return false;
  const [r, g, b] = color.slice(0, 3).map((c) => (c <= 1 ? c * 255 : c));
  return r > 200 && g < 100 && b < 100;
};

type Char = { c: string; x0: number; x1: number; top: number; red: boolean };

/**
 * Each page's words the way pdfplumber's `extract_words(x_tolerance=2,
 * y_tolerance=2)` built them: characters clustered into lines by their top,
 * each line left to right, a new word at whitespace or a gap wider than 2pt.
 */
export function pdfWords(bytes: Uint8Array): PdfWord[][] {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pages: PdfWord[][] = [];
  for (let n = 0; n < doc.countPages(); n++) {
    const chars: Char[] = [];
    doc
      .loadPage(n)
      .toStructuredText('preserve-whitespace')
      .walk({
        onChar(c: string, _origin: mupdf.Point, _font: mupdf.Font, _size: number, quad: mupdf.Quad, color: mupdf.Color) {
          chars.push({ c, x0: Math.min(quad[0], quad[4]), x1: Math.max(quad[2], quad[6]), top: Math.min(quad[1], quad[3]), red: isRed(color as number[]) });
        },
      });
    // Lines: tops within 2pt of the previous one in top order (pdfplumber's cluster_objects).
    const byTop = [...chars].sort((a, b) => a.top - b.top);
    const lines: Char[][] = [];
    for (const char of byTop) {
      const line = lines[lines.length - 1];
      if (line && char.top - line[line.length - 1].top <= 2) line.push(char);
      else lines.push([char]);
    }
    const words: PdfWord[] = [];
    for (const line of lines) {
      let current: Char[] = [];
      const flush = () => {
        if (current.length) {
          words.push({ text: current.map((c) => c.c).join(''), x: Math.min(...current.map((c) => c.x0)), y: Math.min(...current.map((c) => c.top)), isRed: current.some((c) => c.red) });
        }
        current = [];
      };
      for (const char of line.sort((a, b) => a.x0 - b.x0)) {
        if (/^\s$/.test(char.c)) {
          flush();
          continue;
        }
        const prev = current[current.length - 1];
        if (prev && (char.x0 > prev.x1 + 2 || char.x0 < prev.x0)) flush();
        current.push(char);
      }
      flush();
    }
    pages.push(words.filter((word) => word.text.trim()));
  }
  return pages;
}

export async function scrape(meet: string, date: string, urls: string[], adaptive: boolean): Promise<UsamwResult[]> {
  const rows: UsamwResult[] = [];
  for (const url of urls) {
    const parsed = parseUsamwResults(pdfWords(await fetchPdf(url)), meet, date, adaptive);
    console.log(`Parsed ${parsed.length} row(s) from ${url}`);
    rows.push(...parsed);
  }
  return rows;
}

function ingest(rows: UsamwResult[], prod: boolean) {
  const totals = { inserted: 0, updated: 0, unchanged: 0 };
  // One CLI argument stays well under Linux's 128 KB per-argument limit.
  for (let start = 0; start < rows.length; start += 150) {
    const args = ['convex', 'run', 'ingest:upsertLiftingResults', JSON.stringify({ rows: rows.slice(start, start + 150) }), ...(prod ? ['--prod'] : [])];
    const run = spawnSync('bunx', args, { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`convex run failed:\n${run.stderr || run.stdout}`);
    const counts = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))) as typeof totals;
    totals.inserted += counts.inserted;
    totals.updated += counts.updated;
    totals.unchanged += counts.unchanged;
  }
  return totals;
}

async function main() {
  const { values } = parseArgs({
    options: {
      meet: { type: 'string' },
      date: { type: 'string' },
      pdf: { type: 'string', multiple: true },
      adaptive: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      prod: { type: 'boolean', default: false },
    },
  });
  const meet = values.meet?.trim();
  if (!meet || !values.date || !values.pdf?.length) {
    console.error('Usage: bun scripts/usamw-results.ts --meet "Meet Name" --date YYYY-MM-DD --pdf URL [--pdf URL] [--adaptive] [--dry-run] [--prod]');
    process.exit(2);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
    console.error('--date must be YYYY-MM-DD');
    process.exit(2);
  }
  const rows = await scrape(meet, values.date, values.pdf, values.adaptive ?? false);
  if (!rows.length) throw new Error(`Parsed 0 lifting result rows for ${meet}`);
  if (values['dry-run']) {
    console.log(JSON.stringify(rows, null, 1));
    console.log(`${rows.length} row(s) parsed; nothing written (--dry-run).`);
    return;
  }
  const totals = ingest(rows, values.prod ?? false);
  console.log(`USAMW results for ${meet}: ${rows.length} parsed, ${totals.inserted} inserted, ${totals.updated} updated, ${totals.unchanged} unchanged`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
