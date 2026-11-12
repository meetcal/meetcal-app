import { expect, test, type Page } from "@playwright/test";
import { mockAuth, mockSubscribedUser, routeAction, routeNarrowedTable, routeQuery, textAnswer, valueAnswer } from "./support/api";

const stats = {
  totalWeightLifted: 1234, totalMeets: 3, makePercentage: 83.3, bestSnatch: 100, bestCleanJerk: 125, bestTotal: 225,
  averageTotal: 212.5, topMeet: "Spring Open", improvementFromFirst: 5, longestMakeStreak: 7, favoriteAttempt: 2, yearRank: "Meet Regular",
};

async function routeWrapped(page: Page) {
  const asked: Record<string, unknown>[] = [];
  await routeQuery(page, "results:search", (route) => route.fulfill(valueAnswer({ matched_name: null, suggestions: [], results: [], truncated: false })));
  await routeQuery(page, "results:wrapped", (route, args) => {
    asked.push(args);
    if (args.query === "Smith") return route.fulfill(valueAnswer({ kind: "ambiguous", names: ["Ann Smith", "Dee Smith"], truncated: false }));
    return route.fulfill(valueAnswer({ kind: "athlete", name: String(args.query), stats }));
  });
  return asked;
}

const meet = (name: string, start: string) => ({
  name, start_date: start, end_date: start, time_zone: "America/Los_Angeles", venue_city: "Oakland", venue_name: `${name} Arena`,
  venue_state: "CA", venue_street: "100 Main St", venue_zip: "94612", status: "completed", venue_map_pdf_url: null, venue_map_apple_url: null,
});
const ODD_NAME = "A&B + José #1 100% Master's";
const entrant = { member_id: "1", meet: "Meet Alpha", name: "Test Athlete", age: 27, club: "Test Barbell", wso: "Carolina", gender: "Female", weight_class: "69", entry_total: 220, adaptive: false, session_number: 1, session_platform: "Red" };

async function routeMeets(page: Page) {
  await routeQuery(page, "meets:list", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "meets:completed", (route) => route.fulfill(textAnswer([meet("Meet Alpha", "2026-06-20"), meet("Meet Bravo", "2026-05-20"), meet(ODD_NAME, "2026-04-20")])));
  await routeQuery(page, "meets:schedule", (route, args) => route.fulfill(textAnswer([{ date: "2026-06-20", meet: args.meet, platform: `${String(args.meet)} Platform`, session_id: 1, start_time: "10:00", weigh_in_time: "08:00", weight_class: "69kg" }])));
  await routeQuery(page, "meets:athletes", (route, args) => route.fulfill(textAnswer(args.meet === "Meet Alpha" ? [entrant] : [])));
  await routeQuery(page, "results:byMeet", (route) => route.fulfill(textAnswer([])));
}

test("a Wrapped address opens that athlete's year for a signed-out visitor, and survives a reload", async ({ page }) => {
  await mockAuth(page, { signedIn: false });
  const asked = await routeWrapped(page);
  await page.goto("/wrapped?athlete=Ann%20Lee&year=2025");
  await expect(page.getByRole("heading", { name: "2025 Wrapped — Ann Lee" })).toBeVisible();
  await expect(page.getByLabel("Athlete", { exact: true })).toHaveValue("Ann Lee");
  await expect(page.getByLabel("Year")).toHaveValue("2025");
  expect(asked).toEqual([{ query: "Ann Lee", year: 2025 }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "2025 Wrapped — Ann Lee" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.meetcal.app/wrapped");
});

test("building a Wrapped and picking an athlete each add a history entry Back returns through", async ({ page }) => {
  await mockAuth(page, { signedIn: false });
  const asked = await routeWrapped(page);
  await page.goto("/wrapped");
  await expect(page.getByText("Enter an athlete to build their yearly recap.")).toBeVisible();
  await page.getByLabel("Athlete", { exact: true }).fill("Smith");
  await page.getByLabel("Year").fill("2025");
  await page.getByRole("button", { name: "Build wrapped" }).click();
  await expect(page).toHaveURL(/\/wrapped\?athlete=Smith&year=2025$/);
  await page.getByRole("button", { name: "Dee Smith" }).click();
  await expect(page).toHaveURL(/\/wrapped\?athlete=Dee%20Smith&year=2025&picked=1$/);
  await expect(page.getByRole("heading", { name: "2025 Wrapped — Dee Smith" })).toBeVisible();
  expect(asked.at(-1)).toEqual({ query: "Dee Smith", year: 2025, picked: true });

  await page.goBack();
  await expect(page.getByRole("button", { name: "Ann Smith" })).toBeVisible();
  await expect(page.getByLabel("Athlete", { exact: true })).toHaveValue("Smith");
  await page.goBack();
  await expect(page).toHaveURL(/\/wrapped$/);
  await expect(page.getByText("Enter an athlete to build their yearly recap.")).toBeVisible();
  await expect(page.getByLabel("Athlete", { exact: true })).toHaveValue("");
});

test("building a Wrapped again after Back and Forward still writes its address, and building the shown one asks again", async ({ page }) => {
  await mockAuth(page, { signedIn: false });
  const asked = await routeWrapped(page);
  const build = async (athlete: string) => {
    await page.getByLabel("Athlete", { exact: true }).fill(athlete);
    await page.getByRole("button", { name: "Build wrapped" }).click();
  };
  await page.goto("/wrapped?athlete=Start&year=2025");
  await expect(page.getByRole("heading", { name: "2025 Wrapped — Start" })).toBeVisible();
  await build("Ann Lee");
  await expect(page).toHaveURL(/athlete=Ann%20Lee&year=2025$/);
  await build("Bo Kim");
  await expect(page).toHaveURL(/athlete=Bo%20Kim&year=2025$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "2025 Wrapped — Ann Lee" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "2025 Wrapped — Bo Kim" })).toBeVisible();

  await build("Ann Lee");
  await expect(page.getByRole("heading", { name: "2025 Wrapped — Ann Lee" })).toBeVisible();
  await expect(page).toHaveURL(/athlete=Ann%20Lee&year=2025$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "2025 Wrapped — Ann Lee" })).toBeVisible();

  const before = asked.length;
  await page.getByRole("button", { name: "Build wrapped" }).click();
  await expect.poll(() => asked.length).toBe(before + 1);
  await expect(page).toHaveURL(/athlete=Ann%20Lee&year=2025$/);
});

test("a Wrapped address with a year the page cannot build says so and asks for nothing", async ({ page }) => {
  await mockAuth(page, { signedIn: false });
  const asked = await routeWrapped(page);
  await page.goto("/wrapped?athlete=Ann%20Lee&year=1066");
  await expect(page.getByRole("alert")).toHaveText("Enter a year from 1900 to 2100.");
  expect(asked).toEqual([]);
});

test("a Meets address opens that meet, picking another adds an entry, and typing over it clears the address", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeMeets(page);
  await page.goto("/meet-center?meet=Meet%20Alpha");
  await expect(page.locator("#meet-search-input")).toHaveValue("Meet Alpha");
  await expect(page.locator("tbody").first()).toContainText("Meet Alpha Platform");

  await page.locator("#meet-search-input").fill("Meet Br");
  await expect(page).toHaveURL(/\/meet-center$/);
  await expect(page.locator("#meet-search-input")).toHaveValue("Meet Br");
  await page.getByRole("option", { name: "Meet Bravo" }).click();
  await expect(page).toHaveURL(/\/meet-center\?meet=Meet%20Bravo$/);
  await expect(page.locator("tbody").first()).toContainText("Meet Bravo Platform");

  await page.goBack();
  await expect(page).toHaveURL(/\/meet-center$/);
  await expect(page.getByText("Search for and select a meet to load its competition data.")).toBeVisible();
});

test("a meet whose name has marks and separators survives its address and a reload", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeMeets(page);
  await page.goto("/meet-center");
  await page.locator("#meet-search-input").fill("A&B");
  await page.getByRole("option", { name: ODD_NAME }).click();
  await expect(page).toHaveURL(/\/meet-center\?meet=A%26B%20%2B%20Jos%C3%A9%20%231%20100%25%20Master%27s$/);
  await expect(page.locator("tbody").first()).toContainText(`${ODD_NAME} Platform`);
  await page.reload();
  await expect(page.locator("#meet-search-input")).toHaveValue(ODD_NAME);
  await expect(page.locator("tbody").first()).toContainText(`${ODD_NAME} Platform`);
});

test("an athlete link from a meet's results comes back to the same meet", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeMeets(page);
  const result = { name: "Test Athlete", meet: "Meet Alpha", date: "2026-06-20", age: "Senior", body_weight: 70.5, snatch1: 95, snatch2: 100, snatch3: -103, snatch_best: 100, cj1: 120, cj2: 125, cj3: 0, cj_best: 125, total: 225, adaptive: false };
  await routeQuery(page, "results:byMeet", (route) => route.fulfill(textAnswer([result])));
  await routeQuery(page, "results:search", (route) => route.fulfill(valueAnswer({ matched_name: "Test Athlete", suggestions: [], results: [result], truncated: false })));
  await page.goto("/meet-center?meet=Meet%20Alpha&section=results");
  await page.getByRole("link", { name: "Test Athlete" }).click();
  await expect(page).toHaveURL(/\/results\?athlete=Test%20Athlete$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/meet-center\?meet=Meet%20Alpha&section=results$/);
  await expect(page.getByRole("tab", { name: "Full Results" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("tbody").first()).toContainText("Test Athlete");
});

test("the dashboards open from their addresses and write their picks to them", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeMeets(page);
  await routeQuery(page, "reference:clubs", (route) => route.fulfill(textAnswer(["Other Club", "Test Barbell"])));
  await routeQuery(page, "reference:clubMeets", (route) => route.fulfill(valueAnswer({ meets: [{ meet: "Meet Alpha", date: "2026-06-20", status: "completed", has_results: true }], truncated: false })));
  const statsAsked: unknown[] = [];
  await routeQuery(page, "reference:clubMeetStats", (route, args) => {
    statsAsked.push([args.club, args.meet]);
    return route.fulfill(valueAnswer({ total_athletes: 1, gold_medals: 1, silver_medals: 0, bronze_medals: 0, total_prs: 1, perfect_6_for_6: 0, total_weight_lifted: 225, snatch_make_rate: 67, cj_make_rate: 67, combined_make_rate: 67, athlete_results: [] }));
  });
  const meetSelect = page.locator("select").and(page.getByRole("combobox", { name: "Meet" }));

  await page.goto("/club-dashboard?club=Test%20Barbell&meet=Meet%20Alpha");
  await expect(page.getByText("Gold medals")).toBeVisible();
  await expect(page.getByLabel("Club")).toHaveValue("Test Barbell");
  await expect(meetSelect).toHaveValue("Meet Alpha");
  expect(statsAsked).toEqual([["Test Barbell", "Meet Alpha"]]);
  await page.getByLabel("Club").selectOption("Other Club");
  await expect(page).toHaveURL(/\/club-dashboard\?club=Other%20Club$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/club-dashboard\?club=Test%20Barbell&meet=Meet%20Alpha$/);
  await expect(page.getByText("Gold medals")).toBeVisible();

  await page.goto("/wso-dashboard?meet=Meet%20Alpha&wso=Carolina");
  await expect(page.getByText("WSO athletes")).toBeVisible();
  await expect(meetSelect).toHaveValue("Meet Alpha");
  await expect(page.getByLabel("WSO")).toHaveValue("Carolina");
  await meetSelect.selectOption("Meet Bravo");
  await expect(page).toHaveURL(/\/wso-dashboard\?meet=Meet%20Bravo$/);

  await page.goto("/wso-dashboard?wso=Carolina");
  await expect(page.getByText("Choose a meet and WSO to view its dashboard.")).toBeVisible();
  await expect(page.getByText("WSO athletes")).toHaveCount(0);
});

test("a National Rankings address opens that ranking with the form showing it", async ({ page }) => {
  await mockSubscribedUser(page);
  const asked: Record<string, unknown>[] = [];
  for (const fn of ["reference:nationalRankings", "reference:nationalRankingsByYear"]) {
    await routeQuery(page, fn, (route, args) => {
      asked.push(args);
      return route.fulfill(textAnswer([{ name: "First Athlete", total: 260, date: "2026-03-01" }]));
    });
  }
  await page.goto("/national-rankings?federation=USAMW&division=Women%27s%20Masters%20%2840-44%29%2069kg&year=2026");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect(asked).toEqual([{ federation: "USAMW", ageCategory: "Women's Masters (40-44) 69kg", year: "2026", pass: "pass_test" }]);
  await expect(page.getByLabel("Federation")).toHaveValue("USAMW");
  await expect(page.getByLabel("Gender")).toHaveValue("Women");
  await expect(page.getByLabel("Age group")).toHaveValue("Masters 40");
  await expect(page.getByLabel("Division")).toHaveValue("Women's Masters (40-44) 69kg");
  await expect(page.getByLabel("Year (optional)")).toHaveValue("2026");

  await page.getByLabel("Year (optional)").fill("");
  await page.getByRole("button", { name: "View rankings" }).click();
  await expect(page).toHaveURL(/\/national-rankings\?federation=USAMW&division=Women%27s%20Masters%20%2840-44%29%2069kg$/);
  await expect.poll(() => asked.length).toBe(2);
  await page.getByRole("button", { name: "View rankings" }).click();
  await expect.poll(() => asked.length).toBe(3);
  await page.goBack();
  await expect(page.getByLabel("Year (optional)")).toHaveValue("2026");
});

test("a WSO Elite address asks for that WSO and range", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "reference:registrationWsos", (route) => route.fulfill(valueAnswer(["Carolina", "Florida"])));
  const asked: Record<string, unknown>[] = [];
  const empty = { men: [], women: [] };
  await routeAction(page, "results:wsoElite", (route, args) => {
    asked.push(args);
    return route.fulfill(valueAnswer({ wso: args.wso, from: args.from, to: args.to, members: 54, rankings: {
      overall: { percentA: empty, sinclair: empty, qpoints: empty }, youth: { percentA: empty, sinclair: empty },
      junior: { percentA: empty, qpoints: empty, sinclair: empty }, senior: { percentA: empty, qpoints: empty, sinclair: empty },
      masters: { qmasters: empty, percentA: empty, sinclair: empty } } }));
  });
  await page.goto("/wso-elite?wso=Carolina&from=2024-02-01&to=2024-11-30");
  await expect(page.getByRole("heading", { name: "Overall — % of A standard" })).toBeVisible();
  expect(asked).toEqual([{ wso: "Carolina", from: "2024-02-01", to: "2024-11-30", pass: "pass_test" }]);
  await expect(page.getByLabel("WSO")).toHaveValue("Carolina");
  await expect(page.getByLabel("From")).toHaveValue("2024-02-01");

  await page.getByLabel("WSO").selectOption("Florida");
  await page.getByRole("button", { name: "View elite lists" }).click();
  await expect(page).toHaveURL(/\/wso-elite\?wso=Florida&from=2024-02-01&to=2024-11-30$/);
  await expect.poll(() => asked.length).toBe(2);
  await page.getByRole("button", { name: "View elite lists" }).click();
  await expect.poll(() => asked.length).toBe(3);
});

test("the header's link to a data page opens it empty again", async ({ page, isMobile }) => {
  test.skip(isMobile, "The data pages are listed in the desktop menu.");
  await mockSubscribedUser(page);
  await routeMeets(page);
  await page.goto("/meet-center?meet=Meet%20Alpha");
  await expect(page.locator("tbody").first()).toContainText("Meet Alpha Platform");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Competition Data" }).hover();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Meets", exact: true }).click();
  await expect(page).toHaveURL(/\/meet-center$/);
  await expect(page.locator("#meet-search-input")).toHaveValue("");
  await expect(page.getByText("Search for and select a meet to load its competition data.")).toBeVisible();
});

const recordRow = (gender: string, weight_class: string, total_record: number) => ({
  age_category: "Senior", gender, weight_class, record_type: "USAW", snatch_record: total_record - 150, cj_record: 150, total_record,
  snatch_by: null, cj_by: null, total_by: null,
});

async function routeRecords(page: Page) {
  return await routeNarrowedTable(page, "records", [
    recordRow("Women", "77kg", 280), recordRow("Women", "69kg", 260), recordRow("Men", "89kg", 380),
  ]);
}

const shownTotals = (page: Page) => page.locator("tbody tr td:last-child");

test("a reference table opens filtered and sorted from its address, and each pick adds an entry Back returns through", async ({ page }) => {
  await mockSubscribedUser(page);
  const asked = await routeRecords(page);
  await page.goto("/records?gender=Women&sort=total_asc");
  await expect(page.getByRole("combobox", { name: "Gender", exact: true })).toHaveValue("Women");
  expect(asked[0]).toEqual({ gender: "Women", pass: "pass_test" });
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("tbody tr").first()).toContainText("69kg");

  await page.getByRole("combobox", { name: "Weight class", exact: true }).selectOption("77kg");
  await expect(page).toHaveURL(/\/records\?gender=Women&sort=total_asc&class=77kg$/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Sort").selectOption({ index: 0 });
  await expect(page).toHaveURL(/\/records\?gender=Women&class=77kg$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/records\?gender=Women&sort=total_asc&class=77kg$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/records\?gender=Women&sort=total_asc$/);
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: "Weight class", exact: true })).toHaveValue("");
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("tbody tr").first()).toContainText("69kg");
});

test("a reference table address naming a choice the table does not offer shows every row", async ({ page }) => {
  await mockSubscribedUser(page);
  const asked = await routeRecords(page);
  await page.goto("/records?gender=Nobody&class=200kg&sort=not_a_sort");
  await expect(page.locator("tbody tr")).toHaveCount(3);
  expect(asked.at(-1)).toEqual({ pass: "pass_test" });
  await expect(page.getByRole("combobox", { name: "Gender", exact: true })).toHaveValue("");
  await expect(page.locator("tbody tr").first()).toContainText("380");
});

test("WSO Records keeps its organization and filters in the address, and a new organization clears the filters", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "reference:wsoList", (route) => route.fulfill(textAnswer(["Carolina", "Florida"])));
  await routeQuery(page, "reference:wsoRecords", (route, args) => route.fulfill(textAnswer([
    { ...recordRow("Women", "69kg", 200), wso: String(args.wso) },
    { ...recordRow("Men", "89kg", 300), wso: String(args.wso) },
  ])));
  await page.goto("/wso-records?wso=Carolina&gender=Men");
  await expect(page.getByRole("combobox", { name: "Organization", exact: true })).toHaveValue("Carolina");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("89kg");

  await page.getByRole("combobox", { name: "Organization", exact: true }).selectOption("Florida");
  await expect(page).toHaveURL(/\/wso-records\?wso=Florida$/);
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.goBack();
  await expect(page).toHaveURL(/\/wso-records\?wso=Carolina&gender=Men$/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("Adaptive Records keeps its gender in the address", async ({ page }) => {
  await mockSubscribedUser(page);
  const asked: unknown[] = [];
  await routeQuery(page, "reference:adaptiveRecords", (route, args) => {
    asked.push(args.gender);
    return route.fulfill(textAnswer([{ weight_class: "69kg", snatch: 60, cj: 80, total: 140 }]));
  });
  await page.goto("/adaptive-records?gender=Women");
  await expect(page.getByRole("combobox", { name: "Gender", exact: true })).toHaveValue("Women");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Gender", exact: true }).selectOption("Men");
  await expect(page).toHaveURL(/\/adaptive-records$/);
  await expect.poll(() => asked).toEqual(["Women", "Men"]);
  await page.goBack();
  await expect(page).toHaveURL(/\/adaptive-records\?gender=Women$/);
  await expect(page.getByRole("combobox", { name: "Gender", exact: true })).toHaveValue("Women");
});

test("the header's link to a reference table opens it unfiltered", async ({ page, isMobile }) => {
  test.skip(isMobile, "The data pages are listed in the desktop menu.");
  await mockSubscribedUser(page);
  await routeRecords(page);
  await page.goto("/records?gender=Women&class=77kg");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Competition Data" }).hover();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Records", exact: true }).click();
  await expect(page).toHaveURL(/\/records$/);
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(shownTotals(page)).toHaveCount(3);
});
