// USA Masters meet results from result PDFs (port of
// `usamw/results/usamw_results.py`, run by hand with `scripts/usamw-results.ts`).
// The PDFs come as words with positions and colour: a missed attempt is
// printed in red and stored negative. Three layouts are tried in turn, as the
// Python did: per-class tables ("Age Group W70 Weight Category 69"), the
// QMasters attempt table (age group only; the class is inferred from body
// weight), and a looser word-by-word reading.

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

/** "GUNTHER Susan" -> "Susan Gunther" (surname in capitals first); adaptive markers dropped. */
export function normalizeResultName(raw: string): string | null {
  const clean = raw.replace(/\s*\(ADT\d*\)|\[ADT\]\s*|\s*\(adaptive\)/gi, ' ').trim();
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
  if (!/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(text)) throw new Error(`not a number: ${text}`);
  return Math.trunc(Number(text));
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
function parseClassTables(pages: readonly PdfWord[][], ctx: Context): UsamwResult[] {
  const results: UsamwResult[] = [];
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
      const data = line.slice(natIndex + 1);
      if (!name || data.length < 9 || !/^\d+\.?\d*$/.test(data[0].text)) continue;
      try {
        results.push(result(ctx, age, name, Number(data[0].text), data.slice(2, 8).map(attemptWord), whole(data[8].text)));
      } catch {
        continue;
      }
    }
  }
  return results;
}

/** The QMasters attempt table: "Age Group W70" headings, body weight right of x=275, the class inferred from it. */
function parseQMasters(pages: readonly PdfWord[][], ctx: Context): UsamwResult[] {
  const results: UsamwResult[] = [];
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
        results.push(result(ctx, weightCategory ? masters(ageCode, weightCategory)! : age, name, bodyWeight, lifts, total));
      } catch {
        continue;
      }
    }
  }
  return results;
}

/** The loose reading: a number then a capitalised name, then up to twelve numbers until the next lifter or heading. */
function parseLoose(pages: readonly PdfWord[][], ctx: Context): UsamwResult[] {
  const results: UsamwResult[] = [];
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
      const values: { value: string; isRed: boolean }[] = [];
      let j = i + 2;
      while (j < items.length && values.length < 12) {
        const valueText = items[j].text;
        if (valueText === '-') values.push({ value: '0', isRed: false });
        else if (/^\d+\.?\d*$/.test(valueText)) values.push({ value: valueText, isRed: items[j].isRed });
        else if (/\d+\.?\d*/.test(valueText)) {
          for (const number of valueText.match(/\d+\.?\d*/g) ?? []) {
            if (number.includes('.') || number.length >= 2) values.push({ value: number, isRed: items[j].isRed });
          }
        }
        j += 1;
        if (j < items.length) {
          const nextText = items[j].text;
          const nextName = j + 1 < items.length ? items[j + 1].text : '';
          if (/^\d{2,4}$/.test(nextText) && /^[A-Z]+\s+[A-Za-z]+/.test(nextName)) break;
          if (nextText.includes('Age Group')) break;
        }
      }
      if (values.length < 9) {
        i += 1;
        continue;
      }
      const lifts = values.slice(2, 8).map((v) => attempt(v.value, v.isRed));
      results.push(result(ctx, age, name, Number(values[0].value), lifts, whole(values[8].value)));
      i = j;
    }
  }
  return results;
}

/** Results from one PDF's pages: the first layout that yields rows wins. */
export function parseUsamwResults(pages: readonly PdfWord[][], meet: string, date: string, adaptive = false): UsamwResult[] {
  const ctx = { meet, date, adaptive };
  const tables = parseClassTables(pages, ctx);
  if (tables.length) return tables;
  const qmasters = parseQMasters(pages, ctx);
  if (qmasters.length) return qmasters;
  return parseLoose(pages, ctx);
}
