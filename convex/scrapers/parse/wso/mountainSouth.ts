import { intOrNull, type WsoRecord } from './common';

// Mountain South (port of `manual_scrapers/scraper_pdf_mountainsouth.py` and
// its auto wrapper): a men's and a women's PDF linked from the records page,
// sections headed "MASTERS MEN 35-39 - SNATCH", one line per class ("60 Name
// STATE 120 date event location", or just "60" when vacant).

/** The current men's and women's PDFs in the page's "MOUNTAIN SOUTH WSO RECORDS" section. */
export function mountainSouthPdfUrls(html: string): string[] {
  const start = html.indexOf('MOUNTAIN SOUTH WSO RECORDS');
  if (start === -1) return [];
  const archived = html.indexOf('ARCHIVED MOUNTAIN SOUTH WSO RECORDS', start);
  const section = archived === -1 ? html.slice(start, start + 5000) : html.slice(start, archived);
  const genderOf = (text: string) => {
    const upper = text.toUpperCase();
    return upper.includes('WOMEN') ? 'Women' : upper.includes('MEN') ? 'Men' : null;
  };
  const urls: string[] = [];
  for (const [, url, text] of section.matchAll(/href="(https:\/\/mountainsouth\.org\/[^"]+\/Mountain-South-WSO-Records[^"]*\.pdf)"[^>]*>([^<]+)/gi)) {
    if (urls.includes(url) || url.toLowerCase().includes('certificate') || text.toLowerCase().includes('certificate')) continue;
    if (!genderOf(url) && !genderOf(text)) continue;
    urls.push(url);
    if (urls.length >= 2) return urls;
  }
  // Without link text to go by, any two record PDFs in the section.
  const loose: string[] = [];
  for (const [url] of section.matchAll(/https:\/\/mountainsouth\.org\/[^"'>\s]+Mountain-South-WSO-Records[^"'>\s]+\.pdf/gi)) {
    if (loose.includes(url) || url.toLowerCase().includes('certificate')) continue;
    loose.push(url);
    if (loose.length >= 2) break;
  }
  return loose;
}

/** "YOUTH MEN U17 - SNATCH" -> ["U17", "Men"], "MASTERS WOMEN 35-39 - TOTAL" -> ["Masters 35", "Women"]. */
export function mountainSouthSection(line: string): [age: string, gender: 'Men' | 'Women'] | null {
  const header = line.trim().toUpperCase();
  const gender = header.includes('MEN') && !header.includes('WOMEN') ? 'Men' : header.includes('WOMEN') ? 'Women' : null;
  if (!gender) return null;
  if (header.includes('OPEN')) return ['Senior', gender];
  if (header.includes('JUNIOR')) return ['Junior', gender];
  if (['YOUTH', 'U17', 'U15', 'U13'].some((word) => header.includes(word))) {
    if (header.includes('17')) return ['U17', gender];
    if (header.includes('15')) return ['U15', gender];
    if (header.includes('13')) return ['U13', gender];
    return ['Youth', gender];
  }
  if (header.includes('MASTERS')) {
    const range = /(\d+)\s*-\s*\d+/.exec(header);
    if (range) return [`Masters ${range[1]}`, gender];
  }
  return null;
}

/** A positive whole lift, or null (0 means vacant). */
function lift(text: string): number | null {
  const value = intOrNull(text);
  return value ? value : null;
}

const FIELDS = { SNATCH: 'snatch_record', CLEAN_JERK: 'cj_record', TOTAL: 'total_record' } as const;

/** One PDF's records, from its text lines page by page. */
export function parseMountainSouth(pages: readonly (readonly string[])[], wso: string): WsoRecord[] {
  const records = new Map<string, WsoRecord>();
  for (const page of pages) {
    let section: [string, 'Men' | 'Women'] | null = null;
    let field: (typeof FIELDS)[keyof typeof FIELDS] | null = null;
    for (const raw of page) {
      const line = raw.trim();
      if (line.includes(' - SNATCH') || line.includes(' - CLEAN & JERK') || line.includes(' - TOTAL')) {
        const parsed = mountainSouthSection(line);
        if (parsed) {
          section = parsed;
          field = line.includes('SNATCH') ? FIELDS.SNATCH : line.includes('CLEAN') ? FIELDS.CLEAN_JERK : FIELDS.TOTAL;
        }
        continue;
      }
      if ((line.includes('CAT') && line.includes('ATHLETE')) || line.includes('Beginning 6/1/2025')) continue;
      const parts = line.split(/\s+/).filter(Boolean);
      if (!parts.length || !section || !field || !/^\d+$/.test(parts[0].replaceAll('+', ''))) continue;
      const weightClass = parts[0].includes('+') && !parts[0].endsWith('+') ? `${parts[0].replaceAll('+', '')}+` : parts[0];
      const key = JSON.stringify([section[0], section[1], weightClass]);
      const record = records.get(key) ?? { wso, age_category: section[0], gender: section[1], weight_class: weightClass, snatch_record: null, cj_record: null, total_record: null };
      records.set(key, record);
      // The record is the first positive number after the class among the
      // next five words (the athlete's name and state come before it).
      let value: number | null = null;
      if (parts.length >= 4) {
        for (let i = 1; i < Math.min(parts.length, 6) && value === null; i++) value = lift(parts[i]);
      }
      record[field] = value;
    }
  }
  return [...records.values()];
}
