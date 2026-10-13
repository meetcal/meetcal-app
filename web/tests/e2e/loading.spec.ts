import { expect, test, type Route } from "@playwright/test";
import { errorAnswer, mockSubscribedUser, routeQuery, textAnswer, valueAnswer } from "./support/api";

const meet = (name: string) => ({
  name,
  start_date: "2026-06-20",
  end_date: "2026-06-21",
  time_zone: "America/Los_Angeles",
  venue_city: "Oakland",
  venue_name: `${name} Arena`,
  venue_state: "CA",
  venue_street: "100 Main St",
  venue_zip: "94612",
  status: "completed",
  venue_map_pdf_url: null,
  venue_map_apple_url: null,
});

const scheduleRow = (meetName: string, platform: string) => ({
  date: "2026-06-20",
  meet: meetName,
  platform,
  session_id: 1,
  start_time: "10:00",
  weigh_in_time: "08:00",
  weight_class: "69kg",
});

test("a new meet loads at once and never shows the previous meet's answer or a false 'not published'", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "meets:list", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "meets:completed", (route) => route.fulfill(textAnswer([meet("Meet Alpha"), meet("Meet Bravo")])));

  // Meet Alpha's answers wait until released; Meet Bravo's come at once.
  let releaseAlpha = () => {};
  const alphaReleased = new Promise<void>((resolve) => {
    releaseAlpha = resolve;
  });
  const held: Promise<void>[] = [];
  const answer = (rows: (meetName: string) => unknown[]) => async (route: Route, args: Record<string, unknown>) => {
    const meetName = String(args.meet);
    if (meetName === "Meet Alpha") {
      held.push(alphaReleased.then(() => route.fulfill(textAnswer(rows(meetName)))).catch(() => {}));
      return;
    }
    await route.fulfill(textAnswer(rows(meetName)));
  };
  await routeQuery(page, "meets:schedule", answer((meetName) => [scheduleRow(meetName, meetName === "Meet Alpha" ? "Alpha Platform" : "Bravo Platform")]));
  await routeQuery(page, "meets:athletesSessions", answer(() => []));
  await routeQuery(page, "results:byMeet", answer(() => []));

  await page.goto("/meet-center");
  const meetSearch = page.getByRole("searchbox", { name: "Meet" });
  await meetSearch.fill("Meet Alpha");
  await page.getByRole("option", { name: "Meet Alpha" }).click();

  // Still loading: skeletons, not the "nothing chosen" placeholder read as an answer.
  await expect(page.getByLabel("Loading data")).toHaveCount(3);
  await expect(page.getByText("No schedule has been published for this meet.")).toHaveCount(0);
  await expect(page.getByText("No start list has been published for this meet.")).toHaveCount(0);
  await expect(page.getByText("No results have been published for this meet.")).toHaveCount(0);

  // Meet Bravo's answer arrives while Meet Alpha's requests are still pending.
  await meetSearch.fill("Meet Bravo");
  await page.getByRole("option", { name: "Meet Bravo" }).click();
  await expect(page.locator("tbody").first()).toContainText("Bravo Platform");
  await expect(page.getByText("No start list has been published for this meet.")).toBeVisible();

  // Meet Alpha's late answer is never shown under Meet Bravo.
  releaseAlpha();
  await Promise.all(held);
  await page.waitForTimeout(200);
  await expect(page.locator("tbody").first()).toContainText("Bravo Platform");
  await expect(page.getByText("Alpha Platform")).toHaveCount(0);
});

test("a failed load offers Try again and loads after it", async ({ page }) => {
  await mockSubscribedUser(page);
  let requests = 0;
  await routeQuery(page, "reference:standards", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill(errorAnswer("Server Error"));
      return;
    }
    await route.fulfill(textAnswer([{ age_category: "Senior", gender: "Women", standard_a: 200, standard_b: 180, weight_class: "69kg" }]));
  });

  await page.goto("/standards");
  await expect(page.getByRole("alert")).toContainText("Could not load standards: MeetCal could not answer: Server Error");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(requests).toBe(2);
});

test("a load that failed offline explains it plainly and loads again on reconnecting", async ({ page }) => {
  await mockSubscribedUser(page);
  let online = false;
  await routeQuery(page, "reference:records", async (route) => {
    if (!online) {
      await route.abort("internetdisconnected");
      return;
    }
    await route.fulfill(textAnswer([{ age_category: "Senior", gender: "Women", weight_class: "77kg", record_type: "USAW", snatch_record: 130, cj_record: 160, total_record: 287 }]));
  });

  await page.goto("/records");
  await expect(page.getByRole("alert")).toContainText("Could not load records: MeetCal couldn't be reached");
  await expect(page.getByRole("alert")).not.toContainText("reference:records");

  online = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("a request that never answers times out with a clear error", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "The 20 s timeout is the same in every browser.");
  test.setTimeout(60_000);
  await mockSubscribedUser(page);
  await routeQuery(page, "reference:standards", () => {
    // Never answers.
  });

  await page.goto("/standards");
  await expect(page.getByRole("alert")).toContainText("MeetCal took too long to answer", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("filters a page clears show their cleared choice", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "reference:wsoList", (route) => route.fulfill(textAnswer(["Carolina", "Florida"])));
  await routeQuery(page, "reference:wsoRecords", (route, args) => {
    const record = (gender: string) => ({ age_category: "Senior", cj_record: 100, gender, snatch_record: 80, total_record: 180, weight_class: "69kg", wso: args.wso });
    return route.fulfill(textAnswer([record("Women"), record("Men")]));
  });

  await page.goto("/wso-records");
  await page.getByLabel("Organization").selectOption("Carolina");
  await page.getByLabel("Gender").selectOption("Women");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Organization").selectOption("Florida");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByLabel("Gender")).toHaveValue("");

  // Picking the shown value again is a change, so it filters.
  await page.getByLabel("Gender").selectOption("Women");
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("adaptive records keep the gender choice usable through a failed load", async ({ page }) => {
  await mockSubscribedUser(page);
  let failWomen = true;
  await routeQuery(page, "reference:adaptiveRecords", async (route, args) => {
    if (args.gender === "Women" && failWomen) {
      await route.fulfill(errorAnswer("Server Error"));
      return;
    }
    const classes = args.gender === "Women" ? ["69", "77"] : ["95", "110"];
    await route.fulfill(textAnswer(classes.map((weight_class) => ({ weight_class, snatch: 80, cj: 100, total: 180 }))));
  });

  await page.goto("/adaptive-records");
  await page.getByRole("combobox", { name: /^Weight class/ }).selectOption("95");
  await expect(page.locator("tbody tr")).toHaveCount(1);

  await page.getByLabel("Gender").selectOption("Women");
  await expect(page.getByRole("alert")).toContainText("Could not load adaptive records");
  await expect(page.getByLabel("Gender")).toHaveValue("Women");

  failWomen = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: /^Weight class/ })).toHaveValue("");

  await page.getByLabel("Gender").selectOption("Men");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByLabel("Gender")).toHaveValue("Men");
});

test("results search shows the new athlete's answer, never the previous one's", async ({ page }) => {
  await mockSubscribedUser(page);
  let releaseFirst = () => {};
  const firstReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstFulfilled: Promise<void> | undefined;
  const sent: string[] = [];
  await routeQuery(page, "results:search", async (route, args) => {
    const query = String(args.query);
    if (!("startDate" in args)) {
      await route.fulfill(valueAnswer({ matched_name: null, suggestions: [], results: [] }));
      return;
    }
    sent.push(query);
    const body = { matched_name: query, suggestions: [], results: [{ name: query, meet: `${query} Meet`, date: "2026-06-20", age: "Senior", body_weight: 70, snatch1: 90, snatch2: 95, snatch3: 0, snatch_best: 95, cj1: 110, cj2: 115, cj3: 0, cj_best: 115, total: 210, adaptive: false }] };
    if (query === "Ann Lee") {
      firstFulfilled = firstReleased.then(() => route.fulfill(valueAnswer(body))).catch(() => {});
      return;
    }
    await route.fulfill(valueAnswer(body));
  });

  await page.goto("/results");
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  // Enter submits without reaching past the suggestion list, which can cover the button on a phone.
  await athleteSearch.fill("Ann Lee");
  await athleteSearch.press("Enter");
  await expect(page.getByLabel("Loading data")).toBeVisible();

  await athleteSearch.fill("Bo Kim");
  await athleteSearch.press("Enter");
  await expect(page.locator("tbody")).toContainText("Bo Kim Meet");
  expect(sent).toEqual(["Ann Lee", "Bo Kim"]);

  releaseFirst();
  await expect.poll(() => firstFulfilled !== undefined).toBe(true);
  await firstFulfilled;
  await page.waitForTimeout(200);
  await expect(page.locator("tbody")).toContainText("Bo Kim Meet");
  await expect(page.getByText("Ann Lee Meet")).toHaveCount(0);
});

test("searching again for the same athlete searches again", async ({ page }) => {
  await mockSubscribedUser(page);
  let searches = 0;
  await routeQuery(page, "results:search", async (route, args) => {
    if (!("startDate" in args)) {
      await route.fulfill(valueAnswer({ matched_name: null, suggestions: [], results: [] }));
      return;
    }
    searches += 1;
    if (searches === 1) {
      await route.fulfill(errorAnswer("Server Error"));
      return;
    }
    await route.fulfill(valueAnswer({ matched_name: "Ann Lee", suggestions: [], results: [{ name: "Ann Lee", meet: "Ann Lee Meet", date: "2026-06-20", age: "Senior", body_weight: 70, snatch1: 90, snatch2: 95, snatch3: 0, snatch_best: 95, cj1: 110, cj2: 115, cj3: 0, cj_best: 115, total: 210, adaptive: false }] }));
  });

  await page.goto("/results");
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  await athleteSearch.fill("Ann Lee");
  await athleteSearch.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Could not load results");

  // The same search again is sent again, not answered with the earlier error.
  await athleteSearch.press("Enter");
  await expect(page.locator("tbody")).toContainText("Ann Lee Meet");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(searches).toBe(2);
});

test("an unreadable answer is explained without naming the Convex function", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeQuery(page, "reference:standards", (route) =>
    route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{not json" }),
  );

  await page.goto("/standards");
  await expect(page.getByRole("alert")).toContainText("Could not load standards: MeetCal sent an answer this page couldn't read");
  await expect(page.getByRole("alert")).not.toContainText("reference:standards");
});
