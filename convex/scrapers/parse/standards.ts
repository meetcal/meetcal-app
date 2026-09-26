import { parseHtml } from '../lib/html';
import { absoluteUrl } from '../lib/http';

// Pure parsing for `scrapers/standards.ts`, kept free of Convex and Node
// imports so it is unit-tested directly (`standards.test.ts`).

export type Standard = { age_category: string; gender: string; weight_class: string; standard_a: number; standard_b: number };

export function findStandardsPdfUrl(html: string, pageUrl: string): string | null {
  const candidates: string[] = [];
  for (const link of parseHtml(html).querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    const text = link.text.trim();
    if (!text.toLowerCase().includes('standards') && !href.toLowerCase().includes('standards')) continue;
    const url = absoluteUrl(href, pageUrl);
    if (href.toLowerCase().includes('.pdf')) return url;
    candidates.push(url);
  }
  return candidates[0] ?? null;
}

function parseIntValue(value: string): number | null {
  const cleaned = value.replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

/** `_normalize_weight_class`: "58" -> "58kg", "86+" -> "+86kg". */
export function normalizeWeightClass(raw: string): string | null {
  const value = raw.replace('$', '').trim().replace('kg', '').trim();
  if (!value) return null;
  if (value.includes('+')) {
    const digits = /(\d+)/.exec(value);
    return digits ? `+${digits[1]}kg` : `${value.replace('+', '')}+kg`;
  }
  // Python's `value.replace('.', '').isdigit()`.
  return /^\d+$/.test(value.replaceAll('.', '')) ? `${value}kg` : null;
}

function ageAndGender(header: string): [string, string] | null {
  const gender = header.includes('Women') ? 'Women' : header.includes('Men') ? 'Men' : null;
  if (!gender) return null;
  for (const age of ['Senior', 'Junior', 'Youth']) if (header.includes(age)) return [age, gender];
  if (header.includes('U15') || header.includes('u15')) return ['U15', gender];
  return null;
}

/** The standards in the PDF's text lines, in first-seen order of (age, gender, class). */
export function parseStandards(pages: string[][]): Standard[] {
  const byKey = new Map<string, Standard>();
  for (const lines of pages) {
    let section: { age: string; gender: string; isA: boolean; isB: boolean } | null = null;
    let classes: string[] = [];
    for (const line of lines) {
      const [first, ...rest] = line.split(' ');
      if (line.includes('Standard')) {
        const parsed = ageAndGender(line);
        if (parsed) {
          const isU15 = line.includes('U15');
          const isB = !isU15 && line.includes('B Standard');
          const isA = isU15 || line.includes('A Standard') || (line.includes('A') && !line.includes('B Standard'));
          section = { age: parsed[0], gender: parsed[1], isA, isB };
          classes = [];
        }
        continue;
      }
      if (!section) continue;
      if (['category', 'weight'].includes(first.toLowerCase())) {
        classes = rest.map(normalizeWeightClass).filter((c): c is string => c !== null);
        continue;
      }
      if (first.toLowerCase() === 'total' && classes.length > 0) {
        rest.forEach((cell, index) => {
          if (index >= classes.length) return;
          const total = parseIntValue(cell);
          if (total === null) return;
          const key = `${section!.age}|${section!.gender}|${classes[index]}`;
          const standard = byKey.get(key) ?? {
            age_category: section!.age,
            gender: section!.gender,
            weight_class: classes[index],
            standard_a: 0,
            standard_b: 0,
          };
          if (section!.isA) standard.standard_a = total;
          else if (section!.isB) standard.standard_b = total;
          byKey.set(key, standard);
        });
        classes = [];
      }
    }
  }
  return [...byKey.values()];
}
