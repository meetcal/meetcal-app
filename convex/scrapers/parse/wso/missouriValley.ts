import { parseHtml } from '../../lib/html';
import type { WsoRecord } from './common';

// Missouri Valley (missourivalleyweightlifting.org/records): one HTML page,
// read as its lines of text. Gender headings ("Women", "GIRLS", "men") start
// each division; an age heading ("Age 18 – 20", "13 & Under", "age 14 - 15",
// "AGE 35 – 39") and a class heading ("49 kg", "86+ kg") say whose records
// follow, each lift label ("SNATCH:", once typed "5NATCH:") then its value
// ("45 kg – Lily York", "50 kg –" with the name on the next line, or "TBD").
// Youth, junior and senior divisions give the age then its classes; masters
// give each class then its ages, so both headings carry over until replaced.

export const MISSOURI_VALLEY_URL = 'https://missourivalleyweightlifting.org/records/';

const GENDERS: Record<string, 'Men' | 'Women'> = { women: 'Women', girls: 'Women', men: 'Men', boys: 'Men' };
const LIFTS: Record<string, 'snatch_record' | 'cj_record' | 'total_record'> = {
  'SNATCH:': 'snatch_record',
  '5NATCH:': 'snatch_record',
  'CLEAN & JERK:': 'cj_record',
  'TOTAL:': 'total_record',
};

/** "Age 18 – 20" -> Junior, "age 14 - 15" -> U15, "AGE 35 – 39" -> Masters 35, "13 & Under" -> U13. */
export function missouriValleyAge(line: string): string | null {
  const under = /^(\d+)\s*&\s*under$/i.exec(line);
  if (under) return `U${under[1]}`;
  const range = /^age\s+(\d+)\s*[–-]\s*(\d+)$/i.exec(line);
  if (!range) return null;
  const [low, high] = [Number(range[1]), Number(range[2])];
  if (low >= 35) return `Masters ${low}`;
  if (low >= 21) return 'Senior';
  if (low >= 18) return 'Junior';
  return `U${high}`;
}

/** The page's visible lines, from the first division to the end of the records. */
export function missouriValleyLines(html: string): string[] {
  const text = parseHtml(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|span|strong)>/gi, '$&\n')).text;
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function parseMissouriValley(lines: readonly string[], wso = 'Missouri Valley'): WsoRecord[] {
  const records = new Map<string, WsoRecord>();
  let gender: 'Men' | 'Women' | null = null;
  let age: string | null = null;
  let weightClass: string | null = null;
  const record = () => {
    if (!gender || !age || !weightClass) throw new Error(`Missouri Valley: a record before its heading (gender ${gender}, age ${age}, class ${weightClass})`);
    const key = JSON.stringify([age, gender, weightClass]);
    let entry = records.get(key);
    if (!entry) {
      entry = { wso, age_category: age, gender, weight_class: weightClass, snatch_record: null, cj_record: null, total_record: null };
      records.set(key, entry);
    }
    return entry;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^find a club$/i.test(line)) break;
    const lower = line.toLowerCase();
    if (GENDERS[lower]) {
      gender = GENDERS[lower];
      age = null;
      weightClass = null;
      continue;
    }
    const ageHeading = missouriValleyAge(line);
    if (ageHeading) {
      age = ageHeading;
      continue;
    }
    const classHeading = /^(\d+\+?)\s*kg$/i.exec(line);
    if (classHeading) {
      weightClass = classHeading[1];
      continue;
    }
    if (/^no records set$/i.test(line)) {
      record();
      continue;
    }
    const lift = LIFTS[line.toUpperCase()];
    if (!lift || !gender) continue;
    const value = lines[i + 1] ?? '';
    i += 1;
    if (/^tbd$/i.test(value)) {
      record();
      continue;
    }
    const kg = /^(\d+(?:\.\d+)?)\s*kg\b/i.exec(value);
    if (!kg) throw new Error(`Missouri Valley: unreadable ${line} value "${value}" (${age} ${gender} ${weightClass})`);
    record()[lift] = Math.trunc(Number(kg[1]));
  }
  return [...records.values()];
}
