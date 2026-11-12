import * as fc from 'fast-check';

import type { AthleteMeetResult } from '@/data/types/athletes';
import { deriveMostRecentMeetBests } from '@/lib/year-bests';
import { serverLatestMeetBests } from '@/test-support/latest-bests';

const lift = fc.option(fc.integer({ min: -250, max: 250 }), { nil: null });

const rowArb = fc.record({
  date: fc.constantFrom('2024-01-01', '2024-06-01', '2025-03-01'),
  snatch_best: lift,
  snatch1: lift,
  snatch2: lift,
  snatch3: lift,
  cj_best: lift,
  cj1: lift,
  cj2: lift,
  cj3: lift,
  total: fc.integer({ min: 0, max: 450 }),
});

it("matches the client's most-recent-meet bests for answers with one meet per date", () => {
  fc.assert(
    fc.property(fc.array(rowArb, { maxLength: 6 }), (lifts) => {
      const rows = lifts.map((row) => ({ ...row, name: 'A Lifter', meet: `Meet ${row.date}` }) as unknown as AthleteMeetResult);
      const client = deriveMostRecentMeetBests(rows);
      const server = serverLatestMeetBests(rows);
      expect({
        snatch_best: server.bestSnatch > 0 ? server.bestSnatch : null,
        cj_best: server.bestCJ > 0 ? server.bestCJ : null,
        total: server.bestTotal > 0 ? server.bestTotal : null,
      }).toEqual(client);
    }),
  );
});
