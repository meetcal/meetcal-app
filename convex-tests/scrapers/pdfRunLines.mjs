// Prints `pdfRunLines` for the PDF at argv[2] (options as JSON in argv[3]),
// for tests: Jest cannot load unpdf (ESM only), so they run this with Bun,
// which also runs `lib/pdf.ts` as it is.
import { readFileSync } from 'node:fs';
import { pdfRunLines } from '../../convex/scrapers/lib/pdf.ts';

const [file, json] = process.argv.slice(2);
const given = JSON.parse(json ?? '{}');
const options = {};
if (typeof given !== 'object' || given === null || Array.isArray(given)) throw new Error('options must be a JSON object');
for (const key of ['xTolerance', 'yTolerance']) {
  if (key in given && typeof given[key] !== 'number') throw new Error(`${key} must be a number`);
  if (key in given) options[key] = given[key];
}
if ('asDisplayed' in given && typeof given.asDisplayed !== 'boolean') throw new Error('asDisplayed must be a boolean');
if ('asDisplayed' in given) options.asDisplayed = given.asDisplayed;
process.stdout.write(JSON.stringify(await pdfRunLines(new Uint8Array(readFileSync(file)), options)));
