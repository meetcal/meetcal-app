import { expect, test } from "@playwright/test";
import { errorAnswer, mockSubscribedUser, retryableResponse, routeQuery, textAnswer, valueAnswer } from "./support/api";

test("subscribed users can filter and sort qualifying totals", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "reference:qualifyingTotals", async (route) => {
    await route.fulfill(
      textAnswer([
        {
          qualifying_total: 210,
          event_name: "Nationals",
          gender: "Women",
          age_category: "Senior",
          weight_class: "69kg",
        },
        {
          qualifying_total: 310,
          event_name: "Nationals",
          gender: "Men",
          age_category: "Senior",
          weight_class: "88kg",
        },
        {
          qualifying_total: 195,
          event_name: "American Open",
          gender: "Women",
          age_category: "Junior",
          weight_class: "63kg",
        },
        {
          qualifying_total: 340,
          event_name: "Nationals",
          gender: "Men",
          age_category: "Senior",
          weight_class: "110+kg",
        },
        {
          qualifying_total: 330,
          event_name: "Nationals",
          gender: "Men",
          age_category: "Senior",
          weight_class: "110kg",
        },
      ]),
    );
  });

  await page.goto("/qualifying-totals");
  await expect(page.getByRole("heading", { level: 1, name: "Qualifying Totals" })).toBeVisible();
  expect(await page.getByLabel("Weight class").locator("option").allTextContents()).toEqual([
    "All classes",
    "63kg",
    "69kg",
    "88kg",
    "110kg",
    "110+kg",
  ]);
  await page.getByLabel("Gender").selectOption("Women");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("tbody")).not.toContainText("88kg");

  await page.getByLabel("Sort").selectOption("total_desc");
  await expect(page.locator("tbody tr").first()).toContainText("210");
  await expect(page.locator("tbody tr").last()).toContainText("195");
});

test("national rankings submit the expected query and rank totals descending", async ({ page }) => {
  await mockSubscribedUser(page);
  let requestedArgs: Record<string, unknown> = {};
  await routeQuery(page, "reference:nationalRankingsByYear", async (route, args) => {
    requestedArgs = args;
    await route.fulfill(
      textAnswer([
        { name: "Second Athlete", total: 240, date: null },
        { name: "First Athlete", total: 260, date: "2026-03-01" },
      ]),
    );
  });

  await page.goto("/national-rankings");
  await page.getByLabel("Federation").selectOption("USAMW");
  await page.getByLabel("Gender").selectOption("Women");
  await page.getByLabel("Age group").selectOption("Masters 40");
  await page.getByLabel("Division").selectOption("Women's Masters (40-44) 69kg");
  await page.getByLabel("Year (optional)").fill("2026");
  await page.getByRole("button", { name: "View rankings" }).click();

  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("tbody tr").first()).toContainText("First Athlete");
  expect(requestedArgs).toEqual({
    federation: "USAMW",
    ageCategory: "Women's Masters (40-44) 69kg",
    year: "2026",
  });
});

test("WSO records omit the organization column after an organization is selected", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "reference:wsoList", async (route) => {
    await route.fulfill(textAnswer(["California North"]));
  });
  await routeQuery(page, "reference:wsoRecords", async (route) => {
    await route.fulfill(
      textAnswer([
        {
          age_category: "Senior",
          cj_record: 189,
          gender: "Men",
          snatch_record: 158,
          total_record: 347,
          weight_class: "110+kg",
          wso: "California North",
          snatch_by: { name: "Ada Lift", date: "2024-03-02", location: "Oakland, CA" },
          cj_by: { name: "Standard", date: null, location: null },
          total_by: null,
        },
      ]),
    );
  });

  await page.goto("/wso-records");
  await page.getByLabel("Organization").selectOption("California North");

  await expect(page.locator("thead th")).toHaveCount(6);
  await expect(page.getByRole("columnheader", { name: "WSO" })).toHaveCount(0);
  await expect(page.locator("tbody tr").first().locator("td")).toHaveCount(6);
  await expect(page.locator("tbody")).not.toContainText("California North");

  const [snatch, cleanAndJerk, total] = await page.locator("tbody tr").first().locator("td.record-lift").all();
  await expect(snatch.locator(".record-value")).toHaveText("158");
  await expect(snatch.locator(".record-holder")).toHaveText("Ada Lift");
  await expect(snatch.locator(".record-holder-detail")).toHaveText("March 2, 2024 · Oakland, CA");
  await expect(cleanAndJerk.locator(".record-holder")).toHaveText("Standard");
  await expect(cleanAndJerk.locator(".record-holder-detail")).toHaveCount(0);
  await expect(total.locator(".record-holder")).toHaveCount(0);
});

test("records show who set each lift, when and where", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "reference:records", async (route) => {
    await route.fulfill(
      textAnswer([
        {
          age_category: "Senior",
          gender: "Women",
          weight_class: "77kg",
          record_type: "USAW",
          snatch_record: 130,
          cj_record: 160,
          total_record: 287,
          snatch_by: { name: "Ada Lift", date: "2025-06-01", location: "National Championships, Columbus, OH" },
          cj_by: { name: "Bo Press", date: "2024-12-07", location: null },
          total_by: { name: "Ada Lift", date: null, location: "Columbus, OH" },
        },
      ]),
    );
  });

  await page.goto("/records");
  const row = page.locator("tbody tr").first();
  await expect(row.locator("td")).toHaveCount(7);
  const [snatch, cleanAndJerk, total] = await row.locator("td.record-lift").all();
  await expect(snatch).toContainText("130");
  await expect(snatch.locator(".record-holder")).toHaveText("Ada Lift");
  await expect(snatch.locator(".record-holder-detail")).toHaveText("June 1, 2025 · National Championships, Columbus, OH");
  await expect(cleanAndJerk.locator(".record-holder-detail")).toHaveText("December 7, 2024");
  await expect(total.locator(".record-holder-detail")).toHaveText("Columbus, OH");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth + 1),
  );
});

const completeResult = {
  federation: "USAW",
  meet: "Test Meet",
  date: "2026-06-20",
  name: "Test Athlete",
  age: "Senior",
  body_weight: 70.5,
  snatch1: 95,
  snatch2: 100,
  snatch3: -103,
  snatch_best: 100,
  cj1: 120,
  cj2: 125,
  cj3: 0,
  cj_best: 125,
  total: 225,
  adaptive: true,
};

const completedMeet = {
  federation: "USAW",
  end_date: "2026-06-20",
  name: "Test Meet",
  start_date: "2026-06-20",
  time_zone: "America/Los_Angeles",
  venue_city: "Oakland",
  venue_name: "Test Arena",
  venue_state: "CA",
  venue_street: "100 Main St",
  venue_zip: "94612",
  status: "completed",
  venue_map_pdf_url: null,
  venue_map_apple_url: "https://maps.apple.com/?q=Test+Arena",
};

test("athlete results show every competition field except federation", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "results:search", async (route, args) => {
    const isSuggestion = !("startDate" in args);
    await route.fulfill(valueAnswer(isSuggestion
      ? { matched_name: null, suggestions: ["Test Athlete"], results: [] }
      : { matched_name: "Test Athlete", suggestions: [], results: [completeResult] }));
  });
  await page.goto("/results");
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  await athleteSearch.fill("Te");
  await expect(page.getByRole("listbox", { name: "Athlete suggestions" })).toHaveCount(0);
  await athleteSearch.fill("Tes");
  await page.getByRole("option", { name: "Test Athlete" }).click();
  await page.getByRole("button", { name: "Search" }).click();

  const headers = await page.getByRole("columnheader").allTextContents();
  expect(headers).toEqual(["Date", "Meet", "Division", "Bodyweight", "S1", "S2", "S3", "Best snatch", "C&J 1", "C&J 2", "C&J 3", "Best C&J", "Total", "Adaptive"]);
  expect(headers).not.toContain("Federation");
  await expect(page.locator("tbody tr")).toContainText("103×");
  await expect(page.locator("tbody tr")).toContainText("Yes");
});

test("meet center joins details, schedule, start list, and full results", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "meets:list", (route) => route.fulfill(textAnswer([
    { ...completedMeet, status: "scheduled" },
    { ...completedMeet, name: "Later Meet", start_date: "2026-08-20", end_date: "2026-08-21", status: "registration" },
  ])));
  await routeQuery(page, "meets:completed", (route) => route.fulfill(textAnswer([
    { ...completedMeet, name: "Past Meet", start_date: "2025-05-01", end_date: "2025-05-02" },
  ])));
  await routeQuery(page, "meets:schedule", (route) => route.fulfill(textAnswer([{ date: "2026-06-20", meet: "Test Meet", platform: "Red", session_id: 1, start_time: "10:00", weigh_in_time: "08:00", weight_class: "69kg" }])));
  await routeQuery(page, "meets:athletes", (route) => route.fulfill(textAnswer([{ member_id: "1", meet: "Test Meet", name: "Test Athlete", age: 27, club: "Test Barbell", wso: "California North", gender: "Female", weight_class: "+69", entry_total: 220, adaptive: false, session_number: 1, session_platform: "Red" }])));
  await routeQuery(page, "results:byMeet", (route) => route.fulfill(textAnswer([completeResult])));
  await routeQuery(page, "results:search", (route) => route.fulfill(valueAnswer({ matched_name: "Test Athlete", suggestions: [], results: [completeResult] })));
  await page.goto("/meet-center");
  const meetSearch = page.locator("#meet-search-input");
  await meetSearch.fill("me");
  await expect(page.getByRole("listbox", { name: "Meet suggestions" })).toHaveCount(0);
  await meetSearch.fill("mee");
  await expect(page.getByRole("option")).toHaveText(["Later Meet", "Test Meet", "Past Meet"]);
  await page.getByRole("option", { name: "Test Meet" }).click();

  await expect(page.getByText("scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText("Test Arena", { exact: false })).toBeVisible();
  await expect(page.getByText(/June 20, 2026.*June 20, 2026/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start List" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Full Results" })).toBeVisible();
  await expect(page.locator("tbody").first()).toContainText("June 20, 2026");
  await expect(page.locator("tbody").first()).toContainText("8:00 AM");
  await expect(page.locator("tbody").first()).toContainText("10:00 AM");
  await expect(page.locator("tbody").nth(1)).toContainText("Test Athlete");
  // The roster's raw class and gender read as every other table does.
  await expect(page.locator("tbody").nth(1)).toContainText("69+kg");
  await expect(page.locator("tbody").nth(1)).toContainText("Women");
  await expect(page.locator("tbody").nth(1)).not.toContainText("Female");
  await expect(page.locator("tbody").nth(2)).toContainText("Test Athlete");
  await expect(page.getByRole("columnheader").filter({ hasText: /^Total$/ })).toBeVisible();
  await page.getByRole("link", { name: "Test Athlete" }).click();
  await expect(page).toHaveURL(/\/results\?athlete=Test%20Athlete$/);
  await expect(page.getByText("Results for")).toBeVisible();
});

test("club and WSO dashboards expose meet performance metrics", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "reference:clubs", (route) => route.fulfill(textAnswer(["Test Barbell"])));
  // Paged when a cursor is sent: two pages, so the second meet only shows if the site reads past the first.
  await routeQuery(page, "reference:clubAthletes", (route, args) => {
    if (!("cursor" in args)) return route.fulfill(valueAnswer([{ meet: "Test Meet" }]));
    if (args.cursor === null) return route.fulfill(valueAnswer({ json: JSON.stringify([{ meet: "Test Meet" }]), cursor: "page-2", isDone: false }));
    return route.fulfill(valueAnswer({ json: JSON.stringify([{ meet: "Older Meet" }, { meet: "Test Meet" }, { meet: "Upcoming Meet" }]), cursor: "end", isDone: true }));
  });
  // The picker lists the club's completed meets, newest first; "Upcoming Meet" has no results yet.
  await routeQuery(page, "meets:completed", (route) => route.fulfill(textAnswer([{ ...completedMeet, name: "Older Meet", start_date: "2025-03-01", end_date: "2025-03-01" }, completedMeet])));
  await routeQuery(page, "reference:clubMeetStats", (route) => route.fulfill(valueAnswer({ total_athletes: 1, gold_medals: 1, silver_medals: 0, bronze_medals: 0, total_prs: 1, perfect_6_for_6: 0, total_weight_lifted: 225, snatch_make_rate: 67, cj_make_rate: 67, combined_make_rate: 67, athlete_results: [{ name: "Test Athlete", weight_class: "69kg", snatch_best: 100, cj_best: 125, total: 225, body_weight: 70.5, medal: "Gold", snatch_medal: "Gold", cj_medal: "Gold", total_medal: "Gold", is_pr: true, perfect_lifts: false }] })));
  await page.goto("/club-dashboard");
  await page.getByLabel("Club").selectOption("Test Barbell");
  await expect(page.locator("select").and(page.getByRole("combobox", { name: "Meet" })).locator("option")).toHaveText(["Choose a completed meet", "Test Meet", "Older Meet"]);
  await page.locator("select").and(page.getByRole("combobox", { name: "Meet" })).selectOption("Test Meet");
  await expect(page.getByText("Gold medals")).toBeVisible();
  await expect(page.locator("tbody")).toContainText("Test Athlete");
  await expect(page.locator("tbody")).toContainText("Gold");
  await expect(page.locator("tbody")).not.toContainText("gold");

  await routeQuery(page, "meets:list", (route) => route.fulfill(textAnswer([])));
  // The WSO choices are the roster's own WSOs (no reference:wsoList, which only lists WSOs with record sheets).
  const entrant = { member_id: "1", meet: "Test Meet", name: "Test Athlete", age: 27, club: "Test Barbell", wso: "California North", gender: "Female", weight_class: "69", entry_total: 220, adaptive: false, session_number: 1, session_platform: "Red" };
  await routeQuery(page, "meets:athletes", (route) => route.fulfill(textAnswer([entrant, { ...entrant, member_id: "2", name: "Other Athlete", wso: "Tennessee" }])));
  await routeQuery(page, "results:byMeet", (route) => route.fulfill(textAnswer([completeResult])));
  await page.goto("/wso-dashboard");
  await page.locator("select").and(page.getByRole("combobox", { name: "Meet" })).selectOption("Test Meet");
  await expect(page.getByLabel("WSO").locator("option")).toHaveText(["Choose a WSO", "California North", "Tennessee"]);
  await page.getByLabel("WSO").selectOption("California North");
  await expect(page.getByText("WSO athletes")).toBeVisible();
  await expect(page.locator("tbody")).toContainText("225");
  await expect(page.locator("tbody")).toContainText("69kg");
  await expect(page.locator("tbody")).toContainText("Women");

  // A synced roster carries no WSOs: there is no WSO to choose, and the page says why.
  const synced = { member_id: "2", meet: "Test Meet", name: "Synced Athlete", age: 30, club: "Test Barbell", wso: null, gender: "Men", weight_class: "88kg", entry_total: 250, adaptive: false, session_number: null, session_platform: null };
  await routeQuery(page, "meets:athletes", (route) => route.fulfill(textAnswer([synced])));
  await routeQuery(page, "results:byMeet", (route) => route.fulfill(textAnswer([])));
  await page.goto("/wso-dashboard");
  await page.locator("select").and(page.getByRole("combobox", { name: "Meet" })).selectOption("Test Meet");
  await expect(page.getByText("This meet’s start list doesn’t list athletes’ WSOs.")).toBeVisible();
  await expect(page.getByLabel("WSO")).toHaveCount(0);

  // Part of the roster names WSOs and the meet has no results yet (#345):
  // the count says more may attend, and there are no 0% make rates or 0kg lifted.
  await routeQuery(page, "meets:athletes", (route) => route.fulfill(textAnswer([entrant, synced])));
  await page.goto("/wso-dashboard");
  await page.locator("select").and(page.getByRole("combobox", { name: "Meet" })).selectOption("Test Meet");
  await page.getByLabel("WSO").selectOption("California North");
  await expect(page.locator(".data-metric-grid")).toContainText("1+");
  await expect(page.locator(".data-metric-grid")).not.toContainText("0.0%");
  await expect(page.locator(".data-metric-grid")).not.toContainText("0kg");
});

test("wrapped builds a readable single-athlete yearly recap", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "results:search", async (route, args) => {
    const name = String(args.query ?? "");
    if (!("startDate" in args)) {
      await route.fulfill(valueAnswer({ matched_name: null, suggestions: ["Test Athlete"], results: [] }));
      return;
    }
    const result = { ...completeResult, name, meet: "Athletic Lab Weightlifting Club 2026 March Madness Weightlifting Meet" };
    await route.fulfill(valueAnswer({ matched_name: name, suggestions: [], results: [result] }));
  });
  await page.goto("/wrapped");
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  await athleteSearch.fill("Te");
  await expect(page.getByRole("listbox", { name: "Athlete suggestions" })).toHaveCount(0);
  await athleteSearch.fill("Tes");
  await page.getByRole("option", { name: "Test Athlete" }).click();
  await page.getByLabel("Year").fill("2026");
  await page.getByRole("button", { name: "Build wrapped" }).click();

  await expect(page.getByRole("heading", { name: "2026 Wrapped — Test Athlete" })).toBeVisible();
  await expect(page.getByLabel("Compare with (optional)")).toHaveCount(0);
  await expect(page.locator(".wrapped-top-meet")).toContainText("Athletic Lab Weightlifting Club 2026 March Madness Weightlifting Meet");
});

const qualifyingTotal = {
  qualifying_total: 210,
  event_name: "Nationals",
  gender: "Women",
  age_category: "Senior",
  weight_class: "69kg",
};

test("throttled and overloaded API responses are retried after Retry-After", async ({ page }) => {
  await mockSubscribedUser(page);
  const statuses: number[] = [];
  await routeQuery(page, "reference:qualifyingTotals", async (route) => {
    if (statuses.length === 0) {
      statuses.push(429);
      await route.fulfill(retryableResponse(429, "1"));
    } else if (statuses.length === 1) {
      statuses.push(503);
      await route.fulfill(retryableResponse(503));
    } else {
      statuses.push(200);
      await route.fulfill(textAnswer([qualifyingTotal]));
    }
  });

  await page.goto("/qualifying-totals");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("Nationals");
  expect(statuses).toEqual([429, 503, 200]);
});

test("persistent rate limiting explains the failure after two retries", async ({ page }) => {
  await mockSubscribedUser(page);
  let requests = 0;
  await routeQuery(page, "reference:qualifyingTotals", async (route) => {
    requests += 1;
    await route.fulfill(retryableResponse(429, "0"));
  });

  await page.goto("/qualifying-totals");
  await expect(
    page.getByText("Could not load qualifying totals: Too many requests right now; please try again in a moment"),
  ).toBeVisible();
  expect(requests).toBe(3);
});

test("athlete autocomplete waits for typing to pause before searching", async ({ page }) => {
  await mockSubscribedUser(page);
  const queries: string[] = [];
  await routeQuery(page, "results:search", async (route, args) => {
    const query = String(args.query ?? "");
    queries.push(query);
    await route.fulfill(valueAnswer({ matched_name: null, suggestions: [query], results: [] }));
  });

  await page.goto("/results");
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  await athleteSearch.pressSequentially("Test Athlete", { delay: 20 });
  await expect(page.getByRole("option", { name: "Test Athlete" })).toBeVisible();

  // Ten keystrokes reach the three-character threshold; a slow runner may split
  // the burst once, but never sends a search per keystroke.
  expect(queries.length).toBeGreaterThanOrEqual(1);
  expect(queries.length).toBeLessThanOrEqual(2);
  expect(queries.at(-1)).toBe("Test Athlete");
});

test("a slow earlier athlete search cannot replace newer suggestions", async ({ page }) => {
  await mockSubscribedUser(page);
  let releaseSlowSearch = () => {};
  const slowSearchReleased = new Promise<void>((resolve) => {
    releaseSlowSearch = resolve;
  });
  let slowSearchFulfilled: Promise<void> | undefined;
  await routeQuery(page, "results:search", async (route, args) => {
    const query = args.query;
    if (query === "Ann") {
      slowSearchFulfilled = slowSearchReleased.then(() =>
        route.fulfill(valueAnswer({ matched_name: null, suggestions: ["Ann Stale"], results: [] })),
      );
      return;
    }
    await route.fulfill(valueAnswer({ matched_name: null, suggestions: ["Bob Current"], results: [] }));
  });

  await page.goto("/results");
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  const slowRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.postDataJSON()?.args?.query === "Ann",
  );
  await athleteSearch.fill("Ann");
  await slowRequest;
  await athleteSearch.fill("Bob");
  await expect(page.getByRole("option", { name: "Bob Current" })).toBeVisible();

  releaseSlowSearch();
  await expect.poll(() => slowSearchFulfilled !== undefined).toBe(true);
  await slowSearchFulfilled;
  await page.waitForTimeout(100);
  await expect(page.getByRole("option", { name: "Ann Stale" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Bob Current" })).toBeVisible();
});

test("the athlete search is a keyboard-operable combobox", async ({ page }) => {
  await mockSubscribedUser(page);
  const searches: Array<Record<string, unknown>> = [];
  await routeQuery(page, "results:search", async (route, args) => {
    searches.push(args);
    await route.fulfill(valueAnswer("startDate" in args
      ? { matched_name: String(args.query), suggestions: [], results: [completeResult] }
      : { matched_name: null, suggestions: ["Test Athlete", "Tess Lifter"], results: [] }));
  });
  await page.goto("/results");
  const athlete = page.getByRole("combobox", { name: "Athlete" });
  await expect(athlete).toHaveAttribute("aria-expanded", "false");
  await athlete.fill("Tes");
  const listbox = page.getByRole("listbox", { name: "Athlete suggestions" });
  await expect(listbox.getByRole("option")).toHaveText(["Test Athlete", "Tess Lifter"]);
  await expect(athlete).toHaveAttribute("aria-expanded", "true");
  await expect(athlete).toHaveAttribute("aria-controls", (await listbox.getAttribute("id"))!);
  await expect(page.getByRole("status").filter({ hasText: "2 suggestions" })).toBeAttached();

  await athlete.press("ArrowDown");
  await athlete.press("ArrowDown");
  const second = listbox.getByRole("option", { name: "Tess Lifter" });
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(athlete).toHaveAttribute("aria-activedescendant", (await second.getAttribute("id"))!);
  await athlete.press("ArrowUp");
  await expect(listbox.getByRole("option", { name: "Test Athlete" })).toHaveAttribute("aria-selected", "true");
  await expect(athlete).toBeFocused();

  await athlete.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(athlete).toHaveValue("Tes");

  // Down reopens the list on its first option.
  await athlete.press("ArrowDown");
  await expect(listbox.getByRole("option", { name: "Test Athlete" })).toHaveAttribute("aria-selected", "true");
  await athlete.press("Enter");
  await expect(athlete).toHaveValue("Test Athlete");
  await expect(listbox).toBeHidden();
  expect(searches.filter((args) => "startDate" in args)).toHaveLength(0);

  await athlete.press("Enter");
  await expect(page.getByText("Results for")).toBeVisible();
  expect(searches.filter((args) => "startDate" in args)).toHaveLength(1);
});

test("submitting the athlete search closes its suggestions for good", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "results:search", async (route, args) => {
    await route.fulfill(valueAnswer("startDate" in args
      ? { matched_name: String(args.query), suggestions: [], results: [completeResult] }
      : { matched_name: null, suggestions: ["Test Athlete"], results: [] }));
  });
  await page.goto("/results");
  const athlete = page.getByRole("combobox", { name: "Athlete" });
  // Submit before the debounced suggestion search runs.
  await athlete.fill("Test Athlete");
  await athlete.press("Enter");
  await expect(page.getByText("Results for")).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByRole("listbox", { name: "Athlete suggestions" })).toBeHidden();
  await expect(page.locator(".athlete-suggestions")).toBeHidden();
});

test("a failed suggestion search says so instead of showing no matches", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "results:search", (route) => route.fulfill(errorAnswer("boom")));
  await page.goto("/results");
  await page.getByRole("combobox", { name: "Athlete" }).fill("Tes");
  await expect(page.locator(".athlete-suggestions")).toContainText("Couldn’t load athlete suggestions");
  await expect(page.getByText("No matching athletes")).toHaveCount(0);
});

test("a Wrapped choice drops the suggestions for the name it replaced", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "results:search", async (route, args) => {
    const query = String(args.query ?? "");
    if (!("startDate" in args)) {
      await route.fulfill(valueAnswer({ matched_name: null, suggestions: ["Bob Smith", "Cal Smith"], results: [] }));
      return;
    }
    if (query === "Smith") {
      const rows = ["Ann Smith", "Dee Smith"].map((name) => ({ ...completeResult, name, date: "2026-03-01" }));
      await route.fulfill(valueAnswer({ matched_name: null, suggestions: [], results: rows }));
      return;
    }
    await route.fulfill(valueAnswer({ matched_name: query, suggestions: [], results: [{ ...completeResult, name: query }] }));
  });
  await page.goto("/wrapped");
  const athlete = page.getByRole("combobox", { name: "Athlete" });
  await athlete.fill("Smith");
  const listbox = page.getByRole("listbox", { name: "Athlete suggestions" });
  await expect(listbox.getByRole("option")).toHaveText(["Bob Smith", "Cal Smith"]);
  await athlete.press("Escape");
  await page.getByLabel("Year").fill("2026");
  await page.getByRole("button", { name: "Build wrapped" }).click();
  await page.getByRole("group", { name: "Matching athletes" }).getByRole("button", { name: "Ann Smith" }).click();
  await expect(athlete).toHaveValue("Ann Smith");

  await athlete.focus();
  await athlete.press("ArrowDown");
  await expect(listbox).toBeHidden();
  await expect(page.locator(".athlete-suggestions")).toBeHidden();
  await expect(athlete).toHaveAttribute("aria-expanded", "false");
});

test("the meet search is a keyboard-operable combobox", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "meets:list", (route) => route.fulfill(textAnswer([completedMeet])));
  await routeQuery(page, "meets:completed", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "meets:schedule", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "meets:athletesSessions", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "results:byMeet", (route) => route.fulfill(textAnswer([])));
  await page.goto("/meet-center");
  const meet = page.getByRole("combobox", { name: "Meet" });
  await meet.fill("Test");
  await meet.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Test Meet" })).toHaveAttribute("aria-selected", "true");
  await meet.press("Enter");
  await expect(meet).toHaveValue("Test Meet");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
});

test("tapping a suggestion picks it on touch screens", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Touch-only interaction");
  await mockSubscribedUser(page);
  await routeQuery(page, "meets:list", (route) => route.fulfill(textAnswer([completedMeet])));
  await routeQuery(page, "meets:completed", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "meets:schedule", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "meets:athletesSessions", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "results:byMeet", (route) => route.fulfill(textAnswer([])));
  await page.goto("/meet-center");
  const meet = page.getByRole("combobox", { name: "Meet" });
  await meet.tap();
  await meet.fill("Test");
  await page.getByRole("option", { name: "Test Meet" }).tap();
  await expect(meet).toHaveValue("Test Meet");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
});

test("data page fields are at least 16px on phones, so iOS doesn't zoom", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone-only layout assertion");
  await mockSubscribedUser(page);
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "reference:nationalRankings", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "reference:nationalRankingsByYear", (route) => route.fulfill(textAnswer([])));
  for (const path of ["/standards", "/national-rankings", "/wrapped", "/results"]) {
    await page.goto(path);
    await expect(page.locator("main input, main select").first()).toBeVisible();
    const sizes = await page.locator("main input, main select").evaluateAll((fields) =>
      fields.map((field) => [field.id || field.className, parseFloat(getComputedStyle(field).fontSize)] as const),
    );
    for (const [field, size] of sizes) {
      expect(size, `${path} ${field}`).toBeGreaterThanOrEqual(16);
    }
  }
});
