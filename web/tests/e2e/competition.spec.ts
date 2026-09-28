import { expect, test } from "@playwright/test";
import { jsonResponse, mockSubscribedUser, retryableResponse } from "./support/api";

test("subscribed users can filter and sort qualifying totals", async ({ page }) => {
  await mockSubscribedUser(page);
  await page.route("**/data/qualifying-totals", async (route) => {
    await route.fulfill(
      jsonResponse([
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
  let requestedUrl = "";
  await page.route("**/data/nat-rankings-year?**", async (route) => {
    requestedUrl = route.request().url();
    await route.fulfill(
      jsonResponse([
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
  expect(requestedUrl).toContain("federation=USAMW");
  expect(requestedUrl).toContain("year=2026");
  expect(requestedUrl).toContain("age_category=Women%27s+Masters");
});

test("WSO records omit the organization column after an organization is selected", async ({ page }) => {
  await mockSubscribedUser(page);
  await page.route("**/data/wso", async (route) => {
    await route.fulfill(jsonResponse(["California North"]));
  });
  await page.route("**/data/wso/records?**", async (route) => {
    await route.fulfill(
      jsonResponse([
        {
          age_category: "Senior",
          cj_record: 189,
          gender: "Men",
          snatch_record: 158,
          total_record: 347,
          weight_class: "110+kg",
          wso: "California North",
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
  await page.route("**/search?**", async (route) => {
    const url = new URL(route.request().url());
    const isSuggestion = !url.searchParams.has("start_date");
    await route.fulfill(jsonResponse(isSuggestion
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
  await page.route("**/meets", (route) => route.fulfill(jsonResponse([
    { ...completedMeet, status: "scheduled" },
    { ...completedMeet, name: "Later Meet", start_date: "2026-08-20", end_date: "2026-08-21", status: "registration" },
  ])));
  await page.route("**/meets/completed", (route) => route.fulfill(jsonResponse([
    { ...completedMeet, name: "Past Meet", start_date: "2025-05-01", end_date: "2025-05-02" },
  ])));
  await page.route("**/meets/schedule?**", (route) => route.fulfill(jsonResponse([{ date: "2026-06-20", meet: "Test Meet", platform: "Red", session_id: 1, start_time: "10:00", weigh_in_time: "08:00", weight_class: "69kg" }])));
  await page.route("**/meets/athletes-sessions?**", (route) => route.fulfill(jsonResponse([{ member_id: "1", name: "Test Athlete", age: 27, club: "Test Barbell", wso: "California North", gender: "Women", weight_class: "69kg", entry_total: 220, adaptive: false, session_number: 1, session_platform: "Red", date: "2026-06-20", start_time: "10:00", weigh_in_time: "08:00" }])));
  await page.route("**/lifting-results?**", (route) => route.fulfill(jsonResponse([completeResult])));
  await page.route("**/search?**", (route) => route.fulfill(jsonResponse({ matched_name: "Test Athlete", suggestions: [], results: [completeResult] })));
  await page.goto("/meet-center");
  const meetSearch = page.getByRole("searchbox", { name: "Meet" });
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
  await expect(page.locator("tbody").nth(2)).toContainText("Test Athlete");
  await expect(page.getByRole("columnheader").filter({ hasText: /^Total$/ })).toBeVisible();
  await page.getByRole("link", { name: "Test Athlete" }).click();
  await expect(page).toHaveURL(/\/results\?athlete=Test%20Athlete$/);
  await expect(page.getByText("Results for")).toBeVisible();
});

test("club and WSO dashboards expose meet performance metrics", async ({ page }) => {
  await mockSubscribedUser(page);
  await page.route("**/clubs", (route) => route.fulfill(jsonResponse(["Test Barbell"])));
  await page.route("**/clubs/athletes?**", (route) => route.fulfill(jsonResponse([{ meet: "Test Meet" }])));
  await page.route("**/clubs/meet-stats?**", (route) => route.fulfill(jsonResponse({ total_athletes: 1, gold_medals: 1, silver_medals: 0, bronze_medals: 0, total_prs: 1, perfect_6_for_6: 0, total_weight_lifted: 225, snatch_make_rate: 67, cj_make_rate: 67, combined_make_rate: 67, athlete_results: [{ name: "Test Athlete", weight_class: "69kg", snatch_best: 100, cj_best: 125, total: 225, body_weight: 70.5, medal: "Gold", snatch_medal: "Gold", cj_medal: "Gold", total_medal: "Gold", is_pr: true, perfect_lifts: false }] })));
  await page.goto("/club-dashboard");
  await page.getByLabel("Club").selectOption("Test Barbell");
  await page.getByRole("combobox", { name: "Meet" }).selectOption("Test Meet");
  await expect(page.getByText("Gold medals")).toBeVisible();
  await expect(page.locator("tbody")).toContainText("Test Athlete");
  await expect(page.locator("tbody")).toContainText("Gold");
  await expect(page.locator("tbody")).not.toContainText("gold");

  await page.route("**/meets", (route) => route.fulfill(jsonResponse([])));
  await page.route("**/meets/completed", (route) => route.fulfill(jsonResponse([completedMeet])));
  await page.route("**/data/wso", (route) => route.fulfill(jsonResponse(["California North"])));
  await page.route("**/meets/athletes?**", (route) => route.fulfill(jsonResponse([{ member_id: "1", meet: "Test Meet", name: "Test Athlete", age: 27, club: "Test Barbell", wso: "California North", gender: "Women", weight_class: "69kg", entry_total: 220, adaptive: false, session_number: 1, session_platform: "Red" }])));
  await page.route("**/lifting-results?**", (route) => route.fulfill(jsonResponse([completeResult])));
  await page.goto("/wso-dashboard");
  await page.getByRole("combobox", { name: "Meet" }).selectOption("Test Meet");
  await page.getByLabel("WSO").selectOption("California North");
  await expect(page.getByText("WSO athletes")).toBeVisible();
  await expect(page.locator("tbody")).toContainText("225");
});

test("wrapped builds a readable single-athlete yearly recap", async ({ page }) => {
  await mockSubscribedUser(page);
  await page.route("**/search?**", async (route) => {
    const url = new URL(route.request().url());
    const name = url.searchParams.get("query") ?? "";
    if (!url.searchParams.has("start_date")) {
      await route.fulfill(jsonResponse({ matched_name: null, suggestions: ["Test Athlete"], results: [] }));
      return;
    }
    const result = { ...completeResult, name, meet: "Athletic Lab Weightlifting Club 2026 March Madness Weightlifting Meet" };
    await route.fulfill(jsonResponse({ matched_name: name, suggestions: [], results: [result] }));
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
  await page.route("**/data/qualifying-totals", async (route) => {
    if (statuses.length === 0) {
      statuses.push(429);
      await route.fulfill(retryableResponse(429, "1"));
    } else if (statuses.length === 1) {
      statuses.push(503);
      await route.fulfill(retryableResponse(503));
    } else {
      statuses.push(200);
      await route.fulfill(jsonResponse([qualifyingTotal]));
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
  await page.route("**/data/qualifying-totals", async (route) => {
    requests += 1;
    await route.fulfill(retryableResponse(429, "0"));
  });

  await page.goto("/qualifying-totals");
  await expect(
    page.getByText("Could not load qualifying totals: Too many requests right now; please try again in a moment"),
  ).toBeVisible();
  await expect(page.getByText(/returned an error/)).toHaveCount(0);
  expect(requests).toBe(3);
});

test("athlete autocomplete waits for typing to pause before searching", async ({ page }) => {
  await mockSubscribedUser(page);
  const queries: string[] = [];
  await page.route("**/search?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query") ?? "";
    queries.push(query);
    await route.fulfill(jsonResponse({ matched_name: null, suggestions: [query], results: [] }));
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
  await page.route("**/search?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query");
    if (query === "Ann") {
      slowSearchFulfilled = slowSearchReleased.then(() =>
        route.fulfill(jsonResponse({ matched_name: null, suggestions: ["Ann Stale"], results: [] })),
      );
      return;
    }
    await route.fulfill(jsonResponse({ matched_name: null, suggestions: ["Bob Current"], results: [] }));
  });

  await page.goto("/results");
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  const slowRequest = page.waitForRequest((request) => request.url().includes("query=Ann"));
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
