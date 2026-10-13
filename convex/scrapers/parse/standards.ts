import { parseHtml } from '../lib/html';
import { absoluteUrl } from '../lib/http';
import { recordDate } from './holder';

// Pure parsing for `scrapers/standards.ts`, kept free of Convex and Node
// imports so it is unit-tested directly (`standards.test.ts`).

export type Standard = {
  age_category: string;
  gender: string;
  weight_class: string;
  standard_a: number;
  standard_b: number;
  /**
   * The period the PDF lists the standard for (ISO dates), from the heading
   * of its half: "…Bodyweight Categories through July 31, 2026" (`validUntil`)
   * or "…that take effect August 1, 2026" (`validFrom`). Absent when the
   * heading names no date.
   */
  validFrom?: string;
  validUntil?: string;
};

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

const MONTH_DAY_YEAR = '([A-Za-z]{3,}\\.?\\s+\\d{1,2},?\\s+\\d{4})';
const THROUGH = new RegExp(`\\bthrough\\s+${MONTH_DAY_YEAR}`, 'i');
const TAKES_EFFECT = new RegExp(`\\btakes?\\s+effect\\s+(?:on\\s+)?${MONTH_DAY_YEAR}`, 'i');

/** The period a half's heading names ("…through July 31, 2026", "…that take effect August 1, 2026"), or null when it names none. */
export function standardsPeriod(line: string): { validFrom?: string; validUntil?: string } | null {
  const iso = (text: string) => {
    const date = recordDate(text);
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  };
  const until = THROUGH.exec(line);
  if (until && iso(until[1])) return { validUntil: iso(until[1]) };
  const from = TAKES_EFFECT.exec(line);
  if (from && iso(from[1])) return { validFrom: iso(from[1]) };
  return null;
}

/**
 * The standards in the PDF's text lines, in first-seen order of (period,
 * age, gender, class). A PDF that lists the classes before and after a
 * class change keeps both halves apart, each with its period.
 */
export function parseStandards(pages: string[][]): Standard[] {
  const byKey = new Map<string, Standard>();
  let period: { validFrom?: string; validUntil?: string } = {};
  for (const lines of pages) {
    let section: { age: string; gender: string; isA: boolean; isB: boolean } | null = null;
    let classes: string[] = [];
    for (const line of lines) {
      const [first, ...rest] = line.split(' ');
      const named = standardsPeriod(line);
      if (named) {
        period = named;
        section = null;
        classes = [];
        continue;
      }
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
          const key = `${period.validFrom ?? ''}|${period.validUntil ?? ''}|${section!.age}|${section!.gender}|${classes[index]}`;
          const standard = byKey.get(key) ?? {
            age_category: section!.age,
            gender: section!.gender,
            weight_class: classes[index],
            standard_a: 0,
            standard_b: 0,
            ...period,
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

/**
 * The standards in force on `today` (ISO date): a half that ended before it
 * (the retired classes) or takes effect after it is left out, so the
 * readers never list two class sets side by side. A standard with no period
 * is always in force. Throws when the PDF lists two values for one class on
 * one day.
 */
export function currentStandards(standards: readonly Standard[], today: string): Standard[] {
  const current = standards.filter((s) => (s.validUntil === undefined || today <= s.validUntil) && (s.validFrom === undefined || s.validFrom <= today));
  const seen = new Set<string>();
  for (const s of current) {
    const key = `${s.age_category}|${s.gender}|${s.weight_class}`;
    if (seen.has(key)) throw new Error(`two standards in force on ${today} for ${s.age_category} ${s.gender} ${s.weight_class}`);
    seen.add(key);
  }
  return current;
}
