/**
 * The premium soft gate on every surface that shows premium data. The app's
 * screens sit behind `SubscriptionGate`; Siri (App Intents) and the home
 * screen data widgets run outside the React tree and used to answer anyone
 * (#396). Siri's gate is Swift and cannot run under Jest, so this reads the
 * sources and fails when a premium answer skips its gate.
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

/** Screens whose data Siri or the data widgets also show, plus their settings. */
const PREMIUM_SCREENS = [
  "src/app/comp-data/new-qualifying-totals.tsx",
  "src/app/comp-data/new-standards.tsx",
  "src/app/comp-data/rankings.tsx",
  "src/app/comp-data/records.tsx",
  "src/app/schedule-toolbar/widget-settings.tsx",
];

/**
 * What a Siri answer reads premium data through: the live comp-data lookups,
 * the comp-data payloads mirrored for the widgets, and the athlete bests and
 * results queries.
 */
const PREMIUM_SOURCES = [
  "liveQualifyingTotalsResult(",
  "liveStandardsResult(",
  "liveRankingsResult(",
  "liveRecordsResult(",
  "qualifyingTotalsPayload()",
  "standardsPayload()",
  "intlRankingsPayload()",
  "MeetCalAPI.shared.bests(",
  "MeetCalAPI.shared.resultsByNames(",
];

const PREMIUM_ENDPOINTS = [
  "MeetCalAPI.shared.qualifyingTotals()",
  "MeetCalAPI.shared.standards()",
  "MeetCalAPI.shared.records()",
  "MeetCalAPI.shared.intlRankings()",
];

/** Top-level Swift declarations, each with its body, keyed by name. */
function topLevelDeclarations(source: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const chunks = source.split(/^(?=(?:private |fileprivate )?(?:struct|enum|func|actor|class) )/m);
  for (const chunk of chunks) {
    const name = /^(?:private |fileprivate )?(?:struct|enum|func|actor|class) (\w+)/.exec(chunk)?.[1];
    if (name) declarations.set(name, chunk);
  }
  return declarations;
}

describe("premium surfaces", () => {
  it.each(PREMIUM_SCREENS)("%s renders behind SubscriptionGate", (file) => {
    expect(read(file)).toMatch(/<SubscriptionGate\b/);
  });

  const intents = read("plugins/ios-app-intents/Intents.swift");
  const declarations = topLevelDeclarations(intents);
  const intentBodies = Array.from(declarations.entries()).filter(([, body]) =>
    /^struct \w+: AppIntent\b/.test(body),
  );

  it("finds the intents (the parser still matches Intents.swift)", () => {
    const names = intentBodies.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        "GetAthleteResultsIntent",
        "GetQualifyingTotalsIntent",
        "GetStandardsIntent",
        "GetRankingsIntent",
        "GetRecordsIntent",
        "FindMeetsIntent",
      ]),
    );
  });

  it("every Siri intent that reads premium data checks the entitlement first", () => {
    const premiumIntents = intentBodies.filter(([, body]) =>
      PREMIUM_SOURCES.some((source) => body.includes(source)),
    );
    expect(premiumIntents.map(([name]) => name).sort()).toEqual([
      "GetAthleteResultsIntent",
      "GetQualifyingTotalsIntent",
      "GetRankingsIntent",
      "GetRecordsIntent",
      "GetStandardsIntent",
    ]);
    for (const [name, body] of premiumIntents) {
      const gate = body.indexOf("guard PremiumGate.isUnlocked else");
      const firstRead = Math.min(
        ...PREMIUM_SOURCES.map((source) => body.indexOf(source)).filter((index) => index >= 0),
      );
      expect({ name, gated: gate >= 0 && gate < firstRead }).toEqual({ name, gated: true });
    }
  });

  it("the premium tables are only fetched by the gated lookups", () => {
    const helpers = new Set([
      "liveQualifyingTotalsResult",
      "liveStandardsResult",
      "liveRankingsResult",
      "liveRecordsResult",
    ]);
    for (const [name, body] of declarations) {
      if (helpers.has(name)) continue;
      for (const endpoint of PREMIUM_ENDPOINTS) {
        expect({ name, fetches: body.includes(endpoint) }).toEqual({ name, fetches: false });
      }
    }
    // Nothing else in the intents target reads them either.
    for (const file of ["Queries.swift", "SemanticIndex.swift", "Entities.swift"]) {
      const source = read(`plugins/ios-app-intents/${file}`);
      for (const endpoint of [...PREMIUM_ENDPOINTS, ...PREMIUM_SOURCES]) {
        expect({ file, endpoint, found: source.includes(endpoint) }).toEqual({
          file,
          endpoint,
          found: false,
        });
      }
    }
  });

  it("the locked Siri answer fails closed on a missing hint", () => {
    expect(read("targets/SavedWidget/MeetCalSharedModels.swift")).toContain(
      "defaults.bool(forKey: Key.entitlementHint)",
    );
  });

  it("the data widgets refresh with the app's entitlement answer", () => {
    // The root hook passes `useSubscription().isSubscribed`; the refresher
    // writes the subscribe payloads for anything but `true`
    // (lib/data-widgets-refresh.test.ts).
    const hook = read("src/hooks/useDataWidgetRefresh.ts");
    expect(hook).toContain("useSubscription()");
    expect(hook).toContain("refreshDataWidgets(isSubscribed)");
  });
});
