import {
  buildIntlRankingsWidgetPayload,
  buildQualifyingTotalsWidgetPayload,
  buildStandardsWidgetPayload,
  defaultWidgetSettings,
  mergeWidgetSettings,
  WIDGET_PAYLOAD_ROW_LIMIT,
} from "@/utils/dataWidgets";

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
