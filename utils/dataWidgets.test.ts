import {
  buildIntlRankingsFilterSections,
  buildIntlRankingsWidgetPayload,
  buildQualifyingTotalsFilterSections,
  buildQualifyingTotalsWidgetPayload,
  buildRankingAgeCategoryOptions,
  buildStandardsWidgetPayload,
  buildTotalsAgeGroupOptions,
  buildWidgetFilterOptions,
  defaultWidgetSettings,
  hasResolvedWidgetFilters,
  mergeWidgetSettings,
  normalizeWidgetSettings,
  WIDGET_PAYLOAD_ROW_LIMIT,
  WidgetSettings,
} from "@/utils/dataWidgets";
import type { IntlRanking } from "@/lib/database/fetchIntlRankings";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe("data widget payloads", () => {
  it("includes filtered deep links for each widget kind", () => {
    expect(
      buildQualifyingTotalsWidgetPayload(
        {
          Nationals: {
            Junior: {
              Men: {},
              Women: {
                "49": 100,
              },
            },
          },
        },
        { event: "Nationals", gender: "Women", ageGroup: "Junior" },
      ).linkURL,
    ).toBe(
      "meetcal:///comp-data/new-qualifying-totals?event=Nationals&gender=Women&ageGroup=Junior",
    );

    expect(
      buildStandardsWidgetPayload(
        {
          u15: {
            women: [{ weightClass: "49", a: 100, b: 90 }],
          },
        },
        { gender: "women", ageGroup: "u15" },
      ).linkURL,
    ).toBe("meetcal:///comp-data/new-standards?gender=women&ageGroup=u15");

    expect(
      buildIntlRankingsWidgetPayload(
        [
          {
            ranking: 1,
            name: "Athlete A",
            meet: "Worlds",
            ageCategory: "Senior",
            gender: "Men",
            weightClass: "89",
            total: 300,
            percentA: 100,
          },
        ],
        { meet: "Worlds", ageCategory: "Senior", gender: "Men" },
      ).linkURL,
    ).toBe(
      "meetcal:///comp-data/rankings?meet=Worlds&age_category=Senior&gender=Men",
    );
  });

  it("keeps row labels compact for widget display", () => {
    const qualifyingTotalsPayload = buildQualifyingTotalsWidgetPayload(
      {
        Nationals: {
          Senior: {
            Men: {
              "55": 100,
            },
            Women: {},
          },
        },
      },
      { event: "Nationals", gender: "Men", ageGroup: "Senior" },
    );
    expect(qualifyingTotalsPayload.maxRows).toBe(10);
    expect(qualifyingTotalsPayload.rows[0]).toMatchObject({
      leading: "55",
      title: "",
      trailing: "100kg",
    });

    expect(
      buildStandardsWidgetPayload(
        {
          senior: {
            men: [{ weightClass: "89", a: 320, b: 300 }],
          },
        },
        { gender: "men", ageGroup: "senior" },
      ).rows[0],
    ).toMatchObject({
      leading: "89",
      title: "320kg",
      trailing: "300kg",
    });

    const rankingsPayload = buildIntlRankingsWidgetPayload(
      Array.from({ length: 8 }, (_, index) => ({
        ranking: index + 1,
        name: `Athlete ${index + 1}`,
        meet: "Worlds",
        ageCategory: "Senior",
        gender: "Men" as const,
        weightClass: "89",
        total: 300,
        percentA: index === 0 ? 99.95 : 90 - index,
      })),
      { meet: "Worlds", ageCategory: "Senior", gender: "Men" },
    );
    // maxRows is display-only metadata consumed by the native widget; the
    // payload itself carries up to 20 rows regardless of maxRows.
    expect(rankingsPayload.maxRows).toBe(7);
    expect(rankingsPayload.rows).toHaveLength(8);
    expect(rankingsPayload.rows[0].trailing).toBe("99.95%");

    // The payload caps the underlying data at 20 rows even when more match.
    const cappedPayload = buildIntlRankingsWidgetPayload(
      Array.from({ length: 25 }, (_, index) => ({
        ranking: index + 1,
        name: `Athlete ${index + 1}`,
        meet: "Worlds",
        ageCategory: "Senior",
        gender: "Men" as const,
        weightClass: "89",
        total: 300,
        percentA: 90,
      })),
      { meet: "Worlds", ageCategory: "Senior", gender: "Men" },
    );
    expect(cappedPayload.rows).toHaveLength(20);
  });

  it("caps the rows it serializes for every widget kind", () => {
    const totals = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`${index}`, 100 + index]),
    );
    expect(
      buildQualifyingTotalsWidgetPayload(
        { Nationals: { Senior: { Men: totals, Women: {} } } },
        { event: "Nationals", gender: "Men", ageGroup: "Senior" },
      ).rows,
    ).toHaveLength(WIDGET_PAYLOAD_ROW_LIMIT);

    expect(
      buildStandardsWidgetPayload(
        {
          senior: {
            men: Array.from({ length: 40 }, (_, index) => ({
              weightClass: `${index}`,
              a: 300,
              b: 280,
            })),
          },
        },
        { gender: "men", ageGroup: "senior" },
      ).rows,
    ).toHaveLength(WIDGET_PAYLOAD_ROW_LIMIT);
  });

  it("renders an empty payload rather than throwing on empty data", () => {
    expect(
      buildQualifyingTotalsWidgetPayload(
        {},
        { event: "Nationals", gender: "Men", ageGroup: "Senior" },
      ).rows,
    ).toEqual([]);
    expect(
      buildStandardsWidgetPayload({}, { gender: "men", ageGroup: "senior" })
        .rows,
    ).toEqual([]);
    expect(
      buildIntlRankingsWidgetPayload([], {
        meet: "",
        ageCategory: "",
        gender: "",
      }).rows,
    ).toEqual([]);
  });
});

describe("mergeWidgetSettings", () => {
  it("falls back to defaults for a non-object payload", () => {
    expect(mergeWidgetSettings(null)).toEqual(defaultWidgetSettings);
    expect(mergeWidgetSettings("nope")).toEqual(defaultWidgetSettings);
    expect(mergeWidgetSettings([1, 2, 3])).toEqual(defaultWidgetSettings);
  });

  it("ignores a section that is not an object", () => {
    expect(mergeWidgetSettings({ standards: "men" }).standards).toEqual(
      defaultWidgetSettings.standards,
    );
  });

  it("rejects a gender outside the allowed set", () => {
    // "M" is not a key in the standards data, so before narrowing it produced
    // an empty widget with no way to tell why.
    expect(mergeWidgetSettings({ standards: { gender: "M" } }).standards.gender)
      .toBe(defaultWidgetSettings.standards.gender);
    expect(
      mergeWidgetSettings({ qualifyingTotals: { gender: 7 } }).qualifyingTotals
        .gender,
    ).toBe(defaultWidgetSettings.qualifyingTotals.gender);
  });

  it("keeps valid stored values, including the empty intl gender", () => {
    expect(
      mergeWidgetSettings({
        standards: { gender: "women", ageGroup: "u15" },
        intlRankings: { meet: "Worlds", ageCategory: "Junior", gender: "" },
      }),
    ).toEqual({
      ...defaultWidgetSettings,
      standards: { gender: "women", ageGroup: "u15" },
      intlRankings: { meet: "Worlds", ageCategory: "Junior", gender: "" },
    });
  });
});

describe("widget filter policy", () => {
  const totalsData = {
    Nationals: {
      Senior: { Men: { "89": 300 }, Women: { "71": 200 } },
      Junior: { Men: { "89": 250 }, Women: { "71": 170 } },
    },
    "American Open": {
      Senior: { Men: { "89": 280 }, Women: { "71": 190 } },
    },
  };

  const ranking = (over: Partial<IntlRanking>): IntlRanking => ({
    ranking: 1,
    name: "Athlete",
    meet: "Worlds",
    ageCategory: "Senior",
    gender: "Men",
    weightClass: "89",
    total: 300,
    percentA: 100,
    ...over,
  });

  const rankings: IntlRanking[] = [
    ranking({ meet: "Worlds", ageCategory: "Senior", gender: "Men" }),
    ranking({ meet: "Worlds", ageCategory: "Junior", gender: "Women" }),
    ranking({ meet: "Pan Ams", ageCategory: "Senior", gender: "Women" }),
  ];

  it("derives sorted, de-duplicated, non-empty option lists", () => {
    expect(buildWidgetFilterOptions(totalsData, rankings)).toEqual({
      events: ["American Open", "Nationals"],
      rankingMeets: ["Pan Ams", "Worlds"],
      rankingGenders: ["Men", "Women"],
    });
  });

  it("returns empty option lists for empty data rather than throwing", () => {
    expect(buildWidgetFilterOptions({}, [])).toEqual({
      events: [],
      rankingMeets: [],
      rankingGenders: [],
    });
    expect(buildTotalsAgeGroupOptions({}, "Nationals")).toEqual([]);
    expect(buildTotalsAgeGroupOptions(totalsData, "")).toEqual([]);
    expect(buildRankingAgeCategoryOptions([], "Worlds")).toEqual([]);
  });

  it("orders age options by age-group rank, not alphabetically", () => {
    expect(buildTotalsAgeGroupOptions(totalsData, "Nationals")).toEqual([
      "Junior",
      "Senior",
    ]);
    expect(buildRankingAgeCategoryOptions(rankings, "")).toEqual([
      "Junior",
      "Senior",
    ]);
    expect(buildRankingAgeCategoryOptions(rankings, "Pan Ams")).toEqual([
      "Senior",
    ]);
  });

  describe("normalizeWidgetSettings", () => {
    it("returns the same object when every stored filter still resolves", () => {
      const settings: WidgetSettings = {
        qualifyingTotals: { event: "Nationals", gender: "Men", ageGroup: "Senior" },
        standards: { gender: "men", ageGroup: "senior" },
        intlRankings: { meet: "Worlds", ageCategory: "Senior", gender: "Men" },
      };
      expect(normalizeWidgetSettings(settings, totalsData, rankings)).toBe(
        settings,
      );
    });

    it("heals a stored meet that is no longer offered", () => {
      const settings: WidgetSettings = {
        ...defaultWidgetSettings,
        intlRankings: {
          meet: "Last Season Worlds",
          ageCategory: "Senior",
          gender: "Men",
        },
      };
      expect(
        normalizeWidgetSettings(settings, totalsData, rankings).intlRankings
          .meet,
      ).toBe("Pan Ams");
    });

    it("heals an event and re-picks the age group the new event offers", () => {
      const settings: WidgetSettings = {
        ...defaultWidgetSettings,
        qualifyingTotals: {
          event: "Retired Meet",
          gender: "Men",
          ageGroup: "Junior",
        },
      };
      const healed = normalizeWidgetSettings(settings, totalsData, rankings);
      // "American Open" sorts first and only carries Senior.
      expect(healed.qualifyingTotals.event).toBe("American Open");
      expect(healed.qualifyingTotals.ageGroup).toBe("Senior");
    });

    it("prefers Senior and Men when the stored ranking filters are gone", () => {
      const settings: WidgetSettings = {
        ...defaultWidgetSettings,
        intlRankings: { meet: "Worlds", ageCategory: "Masters 35", gender: "" },
      };
      const healed = normalizeWidgetSettings(settings, totalsData, rankings);
      expect(healed.intlRankings.ageCategory).toBe("Senior");
      expect(healed.intlRankings.gender).toBe("Men");
    });

    it("leaves settings untouched when no data has loaded yet", () => {
      expect(normalizeWidgetSettings(defaultWidgetSettings, {}, [])).toBe(
        defaultWidgetSettings,
      );
    });

    it("never leaves the standards section to the ranking data", () => {
      const settings: WidgetSettings = {
        ...defaultWidgetSettings,
        standards: { gender: "women", ageGroup: "u15" },
        intlRankings: { meet: "gone", ageCategory: "Senior", gender: "Men" },
      };
      expect(
        normalizeWidgetSettings(settings, totalsData, rankings).standards,
      ).toEqual({ gender: "women", ageGroup: "u15" });
    });
  });

  describe("hasResolvedWidgetFilters", () => {
    const standardsData = { senior: { men: [] } };
    const resolved: WidgetSettings = {
      qualifyingTotals: { event: "Nationals", gender: "Men", ageGroup: "Senior" },
      standards: { gender: "men", ageGroup: "senior" },
      intlRankings: { meet: "Worlds", ageCategory: "Senior", gender: "Men" },
    };

    it("is true only once every stored filter resolves against loaded data", () => {
      expect(
        hasResolvedWidgetFilters(resolved, totalsData, standardsData, rankings),
      ).toBe(true);
    });

    it("is false while any of the three datasets is still empty", () => {
      expect(hasResolvedWidgetFilters(resolved, {}, standardsData, rankings))
        .toBe(false);
      expect(hasResolvedWidgetFilters(resolved, totalsData, {}, rankings))
        .toBe(false);
      expect(hasResolvedWidgetFilters(resolved, totalsData, standardsData, []))
        .toBe(false);
    });

    it("is false for a stale filter, so a stale widget is never re-committed", () => {
      expect(
        hasResolvedWidgetFilters(
          { ...resolved, intlRankings: { ...resolved.intlRankings, meet: "gone" } },
          totalsData,
          standardsData,
          rankings,
        ),
      ).toBe(false);
      expect(
        hasResolvedWidgetFilters(
          {
            ...resolved,
            qualifyingTotals: { ...resolved.qualifyingTotals, ageGroup: "u13" },
          },
          totalsData,
          standardsData,
          rankings,
        ),
      ).toBe(false);
    });
  });

  describe("filter sections", () => {
    it("labels total age groups and depends on the selected event", () => {
      const sections = buildQualifyingTotalsFilterSections(
        totalsData,
        "American Open",
      );
      expect(sections.map((section) => section.id)).toEqual([
        "event",
        "gender",
        "ageGroup",
      ]);
      expect(sections[0].options.map((option) => option.value)).toEqual([
        "American Open",
        "Nationals",
      ]);
      expect(sections[2].dependsOn).toEqual(["event"]);
      expect(sections[2].options).toEqual([
        { value: "Senior", label: "Senior" },
      ]);
    });

    it("narrows ranking age categories to the selected meet", () => {
      const sections = buildIntlRankingsFilterSections(rankings, "Pan Ams");
      expect(sections.map((section) => section.id)).toEqual([
        "meet",
        "ageCategory",
        "gender",
      ]);
      expect(sections[1].options).toEqual([
        { value: "Senior", label: "Senior" },
      ]);
      expect(sections[2].options.map((option) => option.value)).toEqual([
        "Men",
        "Women",
      ]);
    });

    it("renders empty option lists rather than throwing with no data", () => {
      expect(
        buildQualifyingTotalsFilterSections({}, "")[0].options,
      ).toEqual([]);
      expect(buildIntlRankingsFilterSections([], "")[0].options).toEqual([]);
    });
  });
});
