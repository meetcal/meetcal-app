/**
 * Writes the app's National Rankings divisions (`src/utils/nat-rankings.ts`,
 * built from `src/constants/weight-classes.ts`) to the file the website's
 * picker is tested against:
 *
 *   mise exec -- bun scripts/write-ranking-divisions.ts
 *
 * Run it after changing the class table; `src/utils/nat-rankings.test.ts`
 * fails until the file matches, and `cargo test` in `web/` fails until
 * `division_groups` does.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { rankingDivisionGroups } from '../src/utils/nat-rankings';

const target = join(__dirname, '..', 'web', 'src', 'pages', 'comp_data', 'ranking_divisions.json');
writeFileSync(target, `${JSON.stringify(rankingDivisionGroups(), null, 2)}\n`);
console.log(`wrote ${target}`);
