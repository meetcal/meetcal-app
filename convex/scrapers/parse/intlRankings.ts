import { unescapeHtml } from '../lib/html';

// Pure parsing for `scrapers/intlRankings.ts` (port of
// `usaw/rankings_scraper/intl_rankings_scraper.py`).

export const RANKINGS_PAGE_URL =
  'https://www.usaweightlifting.org/resources/athlete-information-and-programs/international-squad-standings';

export type RankingPdf = { title: string; url: string };
export type MeetInfo = { meet_name: string; gender: string; age_category: string };
export type IntlRanking = {
  meet: string;
  ranking: number;
  name: string;
  weight_class: string;
  total: number | null;
  percent_a: number | null;
  gender: string;
  age_category: string;
};

function fileName(url: string): string {
  const path = new URL(url).pathname;
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Every PDF behind a "View" button on the standings page (the page embeds
 * its cards as JSON), titled by the nearest preceding card title within
 * 3,000 characters.
 */
export function discoverRankingPdfs(page: string): RankingPdf[] {
  const html = unescapeHtml(page);
  const button = /"button_options":\{"button_text":"View","url":"(https:\/\/[^"]+?\.pdf)"/g;
  const seen = new Set<string>();
  const found: RankingPdf[] = [];
  for (const match of html.matchAll(button)) {
    const url = match[1];
    if (seen.has(url)) continue;
    seen.add(url);
    const prefix = html.slice(Math.max(0, (match.index ?? 0) - 3000), match.index);
    const titles = [...prefix.matchAll(/"title":"([^"]+)"/g)];
    found.push({ title: titles.length ? titles[titles.length - 1][1] : fileName(url), url });
  }
  return found;
}

const hasWord = (text: string, word: string) => new RegExp(`\\b${word}\\b`, 'i').test(text);

export function inferMeetInfo(title: string, url = ''): MeetInfo {
  const combined = `${title} ${url}`.replaceAll('_', ' ');
  const lower = combined.toLowerCase();
  let meet_name = '';
  // Olympic qualification standings (from 2026): their own meet, always Senior.
  const olympicQualifier = lower.includes('olympic qualifier');
  if (olympicQualifier) meet_name = 'Olympic Qualifier';
  else if (lower.includes('fisu') || lower.includes('university')) meet_name = 'Worlds';
  else if (lower.includes('pan am') || lower.includes('pan american')) meet_name = 'Pan Ams';
  else if (lower.includes('world')) meet_name = 'Worlds';

  let gender = '';
  if (hasWord(combined, 'men') && !hasWord(combined, 'women')) gender = 'Men';
  else if (hasWord(combined, 'women')) gender = 'Women';

  let age_category = '';
  if (hasWord(combined, 'u15')) age_category = 'U15';
  else if (hasWord(combined, 'u17')) age_category = 'U17';
  else if (lower.includes('junior')) age_category = 'Junior';
  else if (lower.includes('youth')) age_category = 'Youth';
  else if (lower.includes('fisu') || lower.includes('university')) age_category = 'University';
  else if (lower.includes('senior') || lower.includes('world championships') || olympicQualifier) age_category = 'Senior';
  return { meet_name, gender, age_category };
}

/** `parse_meet_info`: the card title first, then the first title-like line of the PDF's first 15. */
export function parseMeetInfo(lines: string[], title: string, url: string): MeetInfo {
  const info = inferMeetInfo(title, url);
  for (const raw of lines.slice(0, 15)) {
    const line = raw.trim();
    if (!['Championships', 'Olympic', 'Rankings', 'University', 'FISU'].some((k) => line.includes(k))) continue;
    if (!info.meet_name) {
      if (line.includes('Olympic Qualifier')) info.meet_name = 'Olympic Qualifier';
      else if (line.includes('FISU') || line.includes('University')) info.meet_name = 'Worlds';
      else if (line.includes('World')) info.meet_name = 'Worlds';
      else if (line.includes('Pan Am') || line.includes('Pan American')) info.meet_name = 'Pan Ams';
      else info.meet_name = 'Worlds';
    }
    if (!info.gender && line.includes('Men') && !line.includes('Women')) info.gender = 'Men';
    else if (!info.gender && line.includes('Women')) info.gender = 'Women';
    if (!info.age_category) {
      if (/\bU15\b/i.test(line)) info.age_category = 'U15';
      else if (/\bU17\b/i.test(line)) info.age_category = 'U17';
      else if (line.includes('Junior')) info.age_category = 'Junior';
      else if (line.includes('Youth')) info.age_category = 'Youth';
      else if (line.includes('University') || line.includes('FISU')) info.age_category = 'University';
      else if (line.includes('Senior') || line.includes('World Championships') || line.includes('Olympic Qualifier')) info.age_category = 'Senior';
    }
    break;
  }
  return info;
}

function cleanNumber(value: string): number | null {
  const digits = value.trim().replace(/[^\d-]/g, '');
  if (!digits || digits === '-' || !/^-?\d+$/.test(digits)) return null;
  return Number(digits);
}

function cleanPercent(value: string): number | null {
  const text = value.trim().replace('%', '');
  if (!text || text === '-') return null;
  const number = Number(text);
  return Number.isFinite(number) && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(text) ? number : null;
}

/**
 * Rows after the table header (`Athlete Name`, or `Body Weight … Total … %`)
 * shaped `rank name bodyweight total percent%`, stopping at the standards
 * table that follows.
 */
export function parseRankingsTable(lines: string[], info: MeetInfo): IntlRanking[] {
  const header = lines.findIndex((line) => /Athlete\s+Name/i.test(line) || /Body\s+Weight.*Total.*%/i.test(line));
  if (header === -1) return [];
  const rankings: IntlRanking[] = [];
  for (const raw of lines.slice(header + 1)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\d+\+?\s*$/.test(line) || line.startsWith('B Standard') || line.startsWith('A Standard')) break;
    const match = /^(\d+)\s+(.+?)\s+(\d+\+?)\s+(\d+)\s+([\d.]+)%/.exec(line);
    if (!match) continue;
    rankings.push({
      meet: info.meet_name,
      ranking: Number(match[1]),
      name: match[2].trim(),
      weight_class: match[3],
      total: cleanNumber(match[4]),
      percent_a: cleanPercent(match[5]),
      gender: info.gender,
      age_category: info.age_category,
    });
  }
  return rankings;
}
