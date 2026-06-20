import {
  buildIntlRankingsWidgetPayload,
  buildQualifyingTotalsWidgetPayload,
  buildStandardsWidgetPayload,
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
    expect(rankingsPayload.maxRows).toBe(7);
    expect(rankingsPayload.rows).toHaveLength(7);
    expect(rankingsPayload.rows[0].trailing).toBe("99.95%");
  });
});
