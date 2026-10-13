// USA Masters meet results from result PDFs (port of
// `usamw/results/usamw_results.py`, run by hand with `scripts/usamw-results.ts`).
// The PDFs come as words with positions and colour: a missed attempt is
// printed in red and stored negative. Three layouts are tried in turn, as the
// Python did: per-class tables ("Age Group W70 Weight Category 69"), the
// QMasters attempt table (age group only; the class is inferred from body
// weight), and a looser word-by-word reading.

import { resultProblems } from '../../lib/plausible';
import { pyInt } from '../lib/numbers';

/** One word on a page: its text, left edge and top (points), and whether any of it is red. */
export type PdfWord = { text: string; x: number; y: number; isRed: boolean };

export type UsamwResult = {
  adaptive: boolean;
  age: string;
  bodyWeight: number;
  snatch1: number;
  snatch2: number;
  snatch3: number;
  snatchBest: number;
  cj1: number;
  cj2: number;
  cj3: number;
  cjBest: number;
  total: number;
  date: string;
  eventId: string;
  federation: 'USAMW';
  meet: string;
  name: string;
};

/** "M40" -> "Men's Masters (40-44)", with the class appended when given. */
function masters(ageCode: string, weightCategory?: string): string | null {
  const match = /^([MW])(\d+)$/.exec(ageCode);
  if (!match) return null;
  const gender = match[1] === 'W' ? "Women's" : "Men's";
  const start = Math.floor(Number(match[2]) / 5) * 5;
  return `${gender} Masters (${start}-${start + 4})${weightCategory === undefined ? '' : ` ${weightCategory}kg`}`;
}

/** The class a body weight falls in, on the classes in force on the meet's date. */
export function inferWeightCategory(ageCode: string, bodyWeight: number, date: string): string | null {
  const match = /^([MW])\d+$/.exec(ageCode);
  if (!match) return null;
  const after = date >= '2026-08-01';
  const classes = match[1] === 'M' ? (after ? [60, 65, 70, 75, 85, 95, 110] : [60, 65, 71, 79, 88, 94, 110]) : after ? [49, 53, 57, 61, 69, 77, 86] : [48, 53, 58, 63, 69, 77, 86];
  const fits = classes.find((weightClass) => bodyWeight <= weightClass);
  return fits === undefined ? `${classes[classes.length - 1]}+` : String(fits);
}

/**
 * Adaptive markers: in brackets (`(ADT2)`, `[ADT]`, `(adaptive)`, any case),
 * or a bare capitalised word (`FARROW Jason ADT2`, #404).
 */
const ADAPTIVE_MARKER = /\s*\(ADT\d*\)\s*|\s*\[ADT\d*\]\s*|\s*\(adaptive\)\s*/gi;
const BARE_ADAPTIVE_MARKER = /(^|\s)ADT\d*(?=\s|$)/g;

/** "GUNTHER Susan" -> "Susan Gunther" (surname in capitals first); adaptive markers dropped. */
export function normalizeResultName(raw: string): string | null {
  const clean = raw.replace(ADAPTIVE_MARKER, ' ').replace(BARE_ADAPTIVE_MARKER, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  let firstNameIndex = parts.findIndex((part) => part !== part.toUpperCase());
  if (firstNameIndex === -1) firstNameIndex = parts.length - 1;
  const lastName = parts
    .slice(0, firstNameIndex)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
  return `${parts.slice(firstNameIndex).join(' ')} ${lastName}`.trim();
}

/** Python's `int(float(text))`; throws where that raises. */
function whole(text: string): number {
  const value = pyInt(text);
  if (value === null) throw new Error(`not a number: ${text}`);
  return value;
}

const attempt = (text: string, isRed: boolean) => (isRed ? -whole(text) : whole(text));
const attemptWord = (word: PdfWord) => (word.text === '-' ? 0 : attempt(word.text, word.isRed));
const bestPositive = (values: number[]) => Math.max(0, ...values.filter((value) => value > 0));

export const slugEventId = (meet: string, date: string) =>
  `${meet
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}-${date}`;

/** Words grouped into lines: sorted top then left, a new line where the top moves 2pt or more. */
export function groupLines(words: readonly PdfWord[]): PdfWord[][] {
  const lines: PdfWord[][] = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last[0].y - word.y) >= 2) lines.push([word]);
    else last.push(word);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

type Context = { meet: string; date: string; adaptive: boolean };

/** A parsed row and the PDF line it was read from, to report a row that fails `usamwRowProblems`. */
export type ParsedRow = { row: UsamwResult; line: string };

const wordsText = (words: readonly PdfWord[]) => words.map((word) => (word.isRed ? `${word.text}*` : word.text)).join(' ');

/** A body weight cell: a number with a decimal point (`74.50`), as every layout prints it. */
const BODY_WEIGHT = /^\d+\.\d+$/;

/**
 * Where the body weight is among a line's numbers: the first, unless that is
 * a whole number (a lot or club number, `12`, `5150`) right before one with a
 * decimal point (#385). Read by position, the stray number shifted every
 * later column: the age taken as the first snatch, the last clean & jerk as
 * the total.
 */
function bodyWeightIndex(texts: readonly string[]): number {
  return !BODY_WEIGHT.test(texts[0] ?? '') && /^\d+$/.test(texts[0] ?? '') && BODY_WEIGHT.test(texts[1] ?? '') ? 1 : 0;
}

function result(ctx: Context, age: string, name: string, bodyWeight: number, lifts: number[], total: number): UsamwResult {
  const [snatch1, snatch2, snatch3, cj1, cj2, cj3] = lifts;
  return {
    adaptive: ctx.adaptive,
    age,
    bodyWeight,
    cj1,
    cj2,
    cj3,
    cjBest: bestPositive([cj1, cj2, cj3]),
    date: ctx.date,
    eventId: slugEventId(ctx.meet, ctx.date),
    federation: 'USAMW',
    meet: ctx.meet,
    name,
    snatch1,
    snatch2,
    snatch3,
    snatchBest: bestPositive([snatch1, snatch2, snatch3]),
    total,
  };
}

/** Per-class tables: "Age Group W70 Weight Category 69", then rank, lot, name, NAT, body weight, age, six attempts, total. */
function parseClassTables(pages: readonly PdfWord[][], ctx: Context): ParsedRow[] {
  const results: ParsedRow[] = [];
  for (const words of pages) {
    let age: string | null = null;
    for (const line of groupLines(words)) {
      const texts = line.map((word) => word.text);
      const heading = /Age Group ([MW]\d+)\s+Weight Category ([\d+]+\+?)/.exec(texts.join(' '));
      if (heading) {
        age = masters(heading[1], heading[2]);
        continue;
      }
      if (!age || line.length < 12 || !/^\d{1,4}$/.test(texts[0]) || !/^\d{1,4}$/.test(texts[1])) continue;
      const natIndex = texts.findIndex((text, index) => index >= 2 && /^[A-Z]{3}$/.test(text));
      if (natIndex <= 2) continue;
      const name = normalizeResultName(texts.slice(2, natIndex).join(' '));
      const after = line.slice(natIndex + 1);
      const data = after.slice(bodyWeightIndex(after.map((word) => word.text)));
      if (!name || data.length < 9 || !/^\d+\.?\d*$/.test(data[0].text)) continue;
      try {
        results.push({ row: result(ctx, age, name, Number(data[0].text), data.slice(2, 8).map(attemptWord), whole(data[8].text)), line: wordsText(line) });
      } catch {
        continue;
      }
    }
  }
  return results;
}

/** The QMasters attempt table: "Age Group W70" headings, body weight right of x=275, the class inferred from it. */
function parseQMasters(pages: readonly PdfWord[][], ctx: Context): ParsedRow[] {
  const results: ParsedRow[] = [];
  for (const words of pages) {
    let ageCode: string | null = null;
    let age: string | null = null;
    for (const line of groupLines(words)) {
      const texts = line.map((word) => word.text);
      const heading = /\bAge Group ([MW]\d+)\b/.exec(texts.join(' '));
      if (heading) {
        ageCode = heading[1];
        age = masters(ageCode);
        continue;
      }
      if (!age || !ageCode || line.length < 13 || !/^\d{1,3}$/.test(texts[0]) || !/^\d{1,4}$/.test(texts[1])) continue;
      const weightIndex = line.findIndex((word, index) => index >= 2 && word.x >= 275 && /^\d+\.\d+$/.test(word.text));
      if (weightIndex < 4) continue;
      const name = normalizeResultName(
        line
          .slice(2, weightIndex)
          .filter((word) => word.x < 185)
          .map((word) => word.text)
          .join(' '),
      );
      const data = line.slice(weightIndex);
      if (!name || data.length < 10) continue;
      try {
        const bodyWeight = Number(data[0].text);
        if (!/^\s*[-+]?\d+\.?\d*\s*$/.test(data[0].text)) throw new Error('body weight');
        whole(data[1].text);
        const lifts = data.slice(2, 8).map(attemptWord);
        const total = whole(data[8].text);
        const weightCategory = inferWeightCategory(ageCode, bodyWeight, ctx.date);
        results.push({ row: result(ctx, weightCategory ? masters(ageCode, weightCategory)! : age, name, bodyWeight, lifts, total), line: wordsText(line) });
      } catch {
        continue;
      }
    }
  }
  return results;
}

/**
 * The loose reading: a number then a capitalised name, then up to twelve
 * numbers until the next lifter or heading. Only words that are a number
 * whole are values: digits inside a word (a club, `5150Barbell`) are not.
 */
function parseLoose(pages: readonly PdfWord[][], ctx: Context): ParsedRow[] {
  const results: ParsedRow[] = [];
  for (const unsorted of pages) {
    const items = [...unsorted].sort((a, b) => a.y - b.y || a.x - b.x);
    let age: string | null = null;
    let i = 0;
    while (i < items.length) {
      const text = items[i].text;
      const lineText = items
        .filter((item) => Math.abs(item.y - items[i].y) < 2)
        .map((item) => item.text)
        .join(' ');
      const heading = /Age Group ([MW]\d+)\s+Weight Category ([\d+]+\+?)/.exec(lineText);
      if (heading) age = masters(heading[1], heading[2]);
      if (!age || !/^\d{1,4}$/.test(text) || i + 1 >= items.length) {
        i += 1;
        continue;
      }
      const name = /^[A-Z]+/.test(items[i + 1].text) ? normalizeResultName(items[i + 1].text) : null;
      if (!name) {
        i += 1;
        continue;
      }
      const read: { value: string; isRed: boolean }[] = [];
      let j = i + 2;
      while (j < items.length && read.length < 12) {
        const valueText = items[j].text;
        if (valueText === '-') read.push({ value: '0', isRed: false });
        else if (/^\d+\.?\d*$/.test(valueText)) read.push({ value: valueText, isRed: items[j].isRed });
        j += 1;
        if (j < items.length) {
          const nextText = items[j].text;
          const nextName = j + 1 < items.length ? items[j + 1].text : '';
          if (/^\d{2,4}$/.test(nextText) && /^[A-Z]+\s+[A-Za-z]+/.test(nextName)) break;
          if (nextText.includes('Age Group')) break;
        }
      }
      const values = read.slice(bodyWeightIndex(read.map((v) => v.value)));
      if (values.length < 9) {
        i += 1;
        continue;
      }
      const lifts = values.slice(2, 8).map((v) => attempt(v.value, v.isRed));
      results.push({ row: result(ctx, age, name, Number(values[0].value), lifts, whole(values[8].value)), line: wordsText(items.slice(i, j)) });
      i = j;
    }
  }
  return results;
}

/** Every row read from one PDF's pages, with its line: the first layout that yields rows wins. */
export function parseUsamwRows(pages: readonly PdfWord[][], meet: string, date: string, adaptive = false): ParsedRow[] {
  const ctx = { meet, date, adaptive };
  const tables = parseClassTables(pages, ctx);
  if (tables.length) return tables;
  const qmasters = parseQMasters(pages, ctx);
  if (qmasters.length) return qmasters;
  return parseLoose(pages, ctx);
}

/** Results from one PDF's pages, unchecked (`checkUsamwRows` checks them). */
export function parseUsamwResults(pages: readonly PdfWord[][], meet: string, date: string, adaptive = false): UsamwResult[] {
  return parseUsamwRows(pages, meet, date, adaptive).map(({ row }) => row);
}

/** A body weight no lifter weighs in at: a column read out of place. */
export const BODY_WEIGHT_RANGE = { min: 20, max: 250 } as const;

/**
 * What makes a parsed row impossible (#385): a body weight out of range, a
 * total that is not the bests' sum (`total` is read from the PDF, the bests
 * from the attempts, so a shifted column or a miss read as a make disagrees),
 * an attempt lighter than the one before it in the same lift (the bar never
 * goes down), and the checks every ranking makes (`resultProblems`).
 */
export function usamwRowProblems(row: UsamwResult): string[] {
  const problems: string[] = [];
  if (!(row.bodyWeight >= BODY_WEIGHT_RANGE.min && row.bodyWeight <= BODY_WEIGHT_RANGE.max)) problems.push(`body weight ${row.bodyWeight}`);
  for (const [label, attempts] of [
    ['snatch', [row.snatch1, row.snatch2, row.snatch3]],
    ['clean & jerk', [row.cj1, row.cj2, row.cj3]],
  ] as const) {
    const taken = attempts.filter((value) => value !== 0).map(Math.abs);
    if (taken.some((value, index) => index > 0 && value < taken[index - 1])) problems.push(`${label} attempts ${attempts.join(', ')} go down`);
  }
  return [...problems, ...resultProblems(row)];
}

export type UsamwCheck = {
  rows: UsamwResult[];
  rejected: { line: string; name: string; problems: string[] }[];
  /**
   * No attempt in the file is a miss, yet most totals disagree with the
   * bests: the PDF marks misses some way other than red text, so every
   * attempt was read as made. Nothing from such a file is right to store.
   */
  missesUndetected: boolean;
};

/** Splits parsed rows into those that pass `usamwRowProblems` and those that do not, with their PDF lines. */
export function checkUsamwRows(parsed: readonly ParsedRow[]): UsamwCheck {
  const rows: UsamwResult[] = [];
  const rejected: UsamwCheck['rejected'] = [];
  let totalMismatches = 0;
  let misses = 0;
  for (const { row, line } of parsed) {
    const lifts = [row.snatch1, row.snatch2, row.snatch3, row.cj1, row.cj2, row.cj3];
    misses += lifts.filter((value) => value < 0).length;
    const problems = usamwRowProblems(row);
    if (problems.some((problem) => problem.startsWith('total ') && problem.includes(' is not '))) totalMismatches += 1;
    if (problems.length) rejected.push({ line, name: row.name, problems });
    else rows.push(row);
  }
  return { rows, rejected, missesUndetected: parsed.length > 0 && misses === 0 && totalMismatches * 2 > parsed.length };
}
