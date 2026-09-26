import { parseHtml, type HTMLElement } from '../lib/html';
import { absoluteUrl } from '../lib/http';

// Pure parsing for `scrapers/records.ts` (port of `usaw/records_scraper`).

export type UsawRecord = {
  record_type: 'USAW';
  age_category: string;
  gender: string;
  weight_class: string;
  snatch_record: number;
  cj_record: number;
  total_record: number;
};

function isCurrentRecordsText(text: string): boolean {
  return text.includes('American Records') && !text.includes('Former') && !text.includes('Prior');
}

/**
 * The current American Records PDF: a "View…" link under a heading that says
 * "American Records" but not "Former"/"Prior" (checked up five ancestors, then
 * three previous siblings), else any PDF link with such text around it.
 */
export function findRecordsPdfUrl(html: string, pageUrl: string): string | null {
  const root = parseHtml(html);
  const links = root.querySelectorAll('a[href]');
  for (const link of links) {
    if (!link.text.trim().toLowerCase().startsWith('view')) continue;
    let found = false;
    let parent: HTMLElement | null = link.parentNode;
    for (let level = 0; level < 5 && parent; level++) {
      if (parent.text.includes('American Records')) {
        if (isCurrentRecordsText(parent.text)) found = true;
        if (found) break;
      }
      parent = parent.parentNode;
    }
    if (!found) {
      let sibling = link.previousElementSibling;
      for (let i = 0; i < 3 && sibling; i++) {
        if (sibling.text.includes('American Records') && isCurrentRecordsText(sibling.text)) {
          found = true;
          break;
        }
        sibling = sibling.previousElementSibling;
      }
    }
    if (found) return absoluteUrl(link.getAttribute('href') ?? '', pageUrl);
  }
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    if (!href.toLowerCase().includes('.pdf')) continue;
    let text = '';
    let parent: HTMLElement | null = link.parentNode;
    for (let i = 0; i < 3 && parent; i++) {
      text += ` ${parent.text}`;
      parent = parent.parentNode;
    }
    if (isCurrentRecordsText(text)) return absoluteUrl(href, pageUrl);
  }
  return null;
}

/** `format_weight_class`: '48' -> '48kg'; '>86', '109+', '+109kg' -> '86+kg' style. */
export function formatWeightClass(raw: string): string | null {
  let value = raw.replaceAll('$', '').trim();
  if (!value) return null;
  if (value.includes('>') || value.includes('+')) {
    const digits = /(\d+)/.exec(value.replace('kg', ''));
    if (digits) return `${digits[1]}+kg`;
  }
  value = value.replace('kg', '').trim();
  return /^\d+$/.test(value) ? `${value}kg` : null;
}

/** `normalize_age_category`: PDF codes to the lowercase labels the scraper sends. */
export function ageCategory(code: string): string | null {
  const upper = code.trim().toUpperCase();
  const fixed: Record<string, string> = { UNI: 'university', OPEN: 'senior', JUNIOR: 'junior', JR: 'junior', U13: 'u13', U15: 'u15', U17: 'u17' };
  if (fixed[upper]) return fixed[upper];
  if (/^[MW]\d+$/.test(upper)) return `Masters ${upper.slice(1)}`;
  return null;
}

function genderOf(code: string): string | null {
  const upper = code.trim().toUpperCase();
  return upper === 'M' ? 'men' : upper === 'F' ? 'women' : null;
}

/**
 * Records from the PDF's text lines. Every age code the scraper keeps is one
 * token, so a kept row is `code gender bodyweight lift record …`; rows it
 * drops ("11 & Under", headers, wrapped event names) fail a token check.
 */
export function parseRecords(pages: string[][]): UsawRecord[] {
  const byKey = new Map<string, UsawRecord>();
  for (const lines of pages) {
    for (const line of lines) {
      const tokens = line.split(' ');
      if (tokens.length < 5) continue;
      const [code, genderCode, bodyweight, lift, value] = tokens;
      const age = ageCategory(code);
      const gender = genderOf(genderCode);
      if (!age || !gender) continue;
      const weightClass = formatWeightClass(bodyweight);
      if (!weightClass) continue;
      if (!value || value.toUpperCase() === 'STANDARD') continue;
      const number = Number(value);
      if (!Number.isFinite(number) || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value)) continue;
      const weight = Math.trunc(number);
      const key = `${age}|${gender}|${weightClass}`;
      const record = byKey.get(key) ?? {
        record_type: 'USAW' as const,
        age_category: age,
        gender,
        weight_class: weightClass,
        snatch_record: 0,
        cj_record: 0,
        total_record: 0,
      };
      const liftUpper = lift.toUpperCase();
      if (liftUpper.includes('SNATCH')) record.snatch_record = weight;
      else if (liftUpper.includes('CLEAN') && liftUpper.includes('JERK')) record.cj_record = weight;
      else if (liftUpper.includes('TOTAL')) record.total_record = weight;
      byKey.set(key, record);
    }
  }
  return [...byKey.values()];
}
