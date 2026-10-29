// Prints `pdfRunLines` for the PDF at argv[2] (options as JSON in argv[3]),
// for tests: Jest cannot load unpdf (ESM only), so they run this with Bun,
// which also runs `lib/pdf.ts` as it is.
import { readFileSync } from 'node:fs';
import { pdfRunLines } from '../../convex/scrapers/lib/pdf.ts';

const [file, options] = process.argv.slice(2);
process.stdout.write(JSON.stringify(await pdfRunLines(new Uint8Array(readFileSync(file)), JSON.parse(options ?? '{}'))));
