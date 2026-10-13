/**
 * The WSOs whose records the `wso-records` job keeps current: one per
 * source in `WSO_SOURCES` (`scrapers/wsoRecords.ts`, a Node module queries
 * cannot import; `convex-tests/scrapers/wsoSources.test.ts` keeps the two in
 * step). The WSO records answers offer only these. Rows stored for any
 * other WSO are never updated or removed by the job: Michigan's and
 * Wisconsin's, loaded once from the Postgres import with the weight classes
 * retired in 2018-2025 and no holders, would otherwise show as current
 * records. `migrations:deleteUnmaintainedWsoRecords` deletes them.
 */
export const MAINTAINED_WSOS: readonly string[] = [
  'Georgia',
  'Pacific Northwest',
  'California North',
  'DMV',
  'Florida',
  'Carolina',
  'New Jersey',
  'Tennessee-Kentucky',
  'Ohio',
  'Pennsylvania-West Virginia',
  'Illinois',
  'Mountain South',
  'New York',
  'New England',
  'Missouri Valley',
  'California South',
  'Minnesota-Dakotas',
  'Texas-Oklahoma',
];

const MAINTAINED = new Set(MAINTAINED_WSOS);

export const isMaintainedWso = (wso: string) => MAINTAINED.has(wso);
