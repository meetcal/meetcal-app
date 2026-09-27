// Pure parsing for `scrapers/usamw.ts` (port of `usamw/records/national_records.py`).

export const PAGE_URL = 'https://usamasters.net/masters-records-grand-slam';

export type UsamwRecord = {
  recordType: 'USAMW';
  ageCategory: string;
  gender: string;
  weightClass: string;
  snatchRecord: number | null;
  cjRecord: number | null;
  totalRecord: number | null;
};

function unescapeHtml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * The current national records PDFs ("NM<date>-MEN.pdf" / "-WOMEN.pdf" on
 * Google Storage), keyed Men/Women; the last match on the page wins, as
 * before. A trailing copy number ("NM20260713-MEN 1.pdf", the July 2026
 * upload) is accepted; the Python pattern rejected it and the job failed.
 */
export function discoverRecordPdfs(page: string): { Men: string; Women: string } {
  const html = unescapeHtml(page);
  const urls: { Men?: string; Women?: string } = {};
  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const url = unescapeHtml(match[1]);
    const lower = url.toLowerCase();
    if (!lower.includes('storage.googleapis.com') || !lower.includes('filename=nm') || !lower.includes('.pdf')) continue;
    if (/[-_ ]women(?:[ _-]*\d+)?\.pdf\b/.test(lower)) urls.Women = url;
    else if (/[-_ ]men(?:[ _-]*\d+)?\.pdf\b/.test(lower)) urls.Men = url;
  }
  const missing = (['Men', 'Women'] as const).filter((g) => !urls[g]);
  if (missing.length) throw new Error(`Could not find national records PDFs for: ${missing.join(', ')}`);
  return urls as { Men: string; Women: string };
}

export function ageCategory(text: string): string | null {
  const range = /\b[MW]\s*(\d+)\s*-\s*\d+\b/.exec(text);
  if (range) return `Masters ${range[1]}`;
  const open = /\b[MW]\s*(\d+)\+/.exec(text);
  return open ? `Masters ${open[1]}` : null;
}

const LINE = /^(\d+\+?)\s+(SNA|SNATCH|CNJ|C&J|CLEAN|TOT|TOTAL)\s+(\d+(?:\.\d+)?)\b/i;

function weightOrder(weightClass: string): number {
  return Number(weightClass.replace('+kg', '.5').replace('kg', ''));
}

/**
 * Records from one PDF (one gender): each page names its age group in its
 * first eight lines ("M35-39"), then `class lift record` lines. Sorted by
 * gender, age, then class, as before.
 */
export function parseRecordPages(pages: string[][], gender: string): UsamwRecord[] {
  const byKey = new Map<string, UsamwRecord>();
  for (const lines of pages) {
    const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
    let age: string | null = null;
    for (const line of nonEmpty.slice(0, 8)) {
      age = ageCategory(line);
      if (age) break;
    }
    if (!age) continue;
    for (const line of nonEmpty) {
      const match = LINE.exec(line);
      if (!match) continue;
      const weightClass = `${match[1]}kg`;
      const key = `${age}|${gender}|${weightClass}`;
      const record = byKey.get(key) ?? {
        recordType: 'USAMW' as const,
        ageCategory: age,
        gender,
        weightClass,
        snatchRecord: null,
        cjRecord: null,
        totalRecord: null,
      };
      const value = Math.trunc(Number(match[3]));
      const lift = match[2].toUpperCase();
      if (lift.startsWith('SNA')) record.snatchRecord = value;
      else if (lift === 'CNJ' || lift === 'C&J' || lift.startsWith('CLEAN')) record.cjRecord = value;
      else if (lift.startsWith('TOT')) record.totalRecord = value;
      byKey.set(key, record);
    }
  }
  const ageNumber = (r: UsamwRecord) => Number(/\d+/.exec(r.ageCategory)![0]);
  return [...byKey.values()].sort(
    (a, b) =>
      (a.gender < b.gender ? -1 : a.gender > b.gender ? 1 : 0) ||
      ageNumber(a) - ageNumber(b) ||
      weightOrder(a.weightClass) - weightOrder(b.weightClass),
  );
}
