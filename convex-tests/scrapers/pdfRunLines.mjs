// Prints `pdfRunLines` for the PDF at argv[2] as JSON, for tests: Jest cannot
// load unpdf (ESM only), and Node runs `lib/pdf.ts` itself by stripping its types.
import { readFileSync } from 'node:fs';
import { pdfRunLines } from '../../convex/scrapers/lib/pdf.ts';

const [file, options] = process.argv.slice(2);
process.stdout.write(JSON.stringify(await pdfRunLines(new Uint8Array(readFileSync(file)), JSON.parse(options ?? '{}'))));
