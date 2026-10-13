import { MAINTAINED_WSOS } from '../../convex/lib/wsoSources';
import { WSO_SOURCES } from '../../convex/scrapers/wsoRecords';

describe('maintained WSOs', () => {
  // The WSO records answers offer only these, so a WSO with a source must be listed, and none without.
  it('lists exactly the WSOs the wso-records job scrapes', () => {
    expect([...MAINTAINED_WSOS].sort()).toEqual(WSO_SOURCES.map((source) => source.wso).sort());
    expect(new Set(MAINTAINED_WSOS).size).toBe(MAINTAINED_WSOS.length);
  });
});
