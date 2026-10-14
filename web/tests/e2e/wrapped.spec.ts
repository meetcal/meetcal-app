import { expect, test, type Page } from "@playwright/test";
import { mockAuth, mockSubscribedUser, routeQuery, valueAnswer } from "./support/api";

// Athlete Wrapped shows the server's answer (`results:wrapped`, a public
// query), so it is free: no gate, no access pass, signed out included.

const stats = {
  totalWeightLifted: 1250,
  totalMeets: 3,
  makePercentage: 83.33333333333334,
  bestSnatch: 100,
  bestCleanJerk: 125,
  bestTotal: 225,
  averageTotal: 212.5,
  topMeet: "Athletic Lab Weightlifting Club 2026 March Madness Weightlifting Meet",
  improvementFromFirst: 12,
  longestMakeStreak: 7,
  favoriteAttempt: 2,
  yearRank: "Meet Regular",
};

/** Answers the athlete autocomplete (`results:search` without dates) with `names`. */
async function routeSuggestions(page: Page, names: string[] = []) {
  await routeQuery(page, "results:search", (route) =>
    route.fulfill(valueAnswer({ matched_name: null, suggestions: names, results: [] })),
  );
}

/** Answers `results:wrapped` with `answer(args)` and records each call's arguments. */
async function routeWrapped(page: Page, answer: (args: Record<string, unknown>) => unknown) {
  const calls: Array<Record<string, unknown>> = [];
  await routeQuery(page, "results:wrapped", (route, args) => {
    calls.push(args);
    return route.fulfill(valueAnswer(answer(args)));
  });
  return calls;
}

async function build(page: Page, athlete: string, year = "2026") {
  await page.getByRole("combobox", { name: "Athlete" }).fill(athlete);
  await page.getByLabel("Year").fill(year);
  await page.getByRole("button", { name: "Build wrapped" }).click();
}

test("wrapped shows the server's recap for one athlete", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeSuggestions(page, ["Test Athlete"]);
  const calls = await routeWrapped(page, () => ({ kind: "athlete", name: "Test Athlete", stats }));
  await page.goto("/wrapped");
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  await athleteSearch.fill("Te");
  await expect(page.getByRole("listbox", { name: "Athlete suggestions" })).toHaveCount(0);
  await athleteSearch.fill("Tes");
  await page.getByRole("option", { name: "Test Athlete" }).click();
  await page.getByLabel("Year").fill("2026");
  await page.getByRole("button", { name: "Build wrapped" }).click();

  await expect(page.getByRole("heading", { name: "2026 Wrapped — Test Athlete" })).toBeVisible();
  const metrics = page.locator(".data-metric-grid");
  await expect(metrics).toContainText("83.3%");
  await expect(metrics).toContainText("125kg");
  await expect(metrics).toContainText("212.5kg");
  await expect(metrics).toContainText("+12kg");
  await expect(page.locator(".wrapped-top-meet")).toContainText("Athletic Lab Weightlifting Club 2026 March Madness Weightlifting Meet");
  // One request, the query and year only: no dates, no pass, not picked.
  expect(calls).toEqual([{ query: "Test Athlete", year: 2026 }]);
});

test("picking one of several matching athletes asks again for that exact name", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeSuggestions(page, ["Bob Smith", "Cal Smith"]);
  const calls = await routeWrapped(page, (args) =>
    args.picked
      ? { kind: "athlete", name: String(args.query), stats }
      : { kind: "ambiguous", names: ["Ann Smith", "Dee Smith"], truncated: false },
  );
  await page.goto("/wrapped");
  const athlete = page.getByRole("combobox", { name: "Athlete" });
  await athlete.fill("Smith");
  const listbox = page.getByRole("listbox", { name: "Athlete suggestions" });
  await expect(listbox.getByRole("option")).toHaveText(["Bob Smith", "Cal Smith"]);
  await athlete.press("Escape");
  await page.getByLabel("Year").fill("2026");
  await page.getByRole("button", { name: "Build wrapped" }).click();

  await expect(page.locator("p.data-status")).toHaveText("Several athletes match Smith. Pick one.");
  await page.getByRole("group", { name: "Matching athletes" }).getByRole("button", { name: "Ann Smith" }).click();
  await expect(page.getByRole("heading", { name: "2026 Wrapped — Ann Smith" })).toBeVisible();
  expect(calls).toEqual([
    { query: "Smith", year: 2026 },
    { query: "Ann Smith", year: 2026, picked: true },
  ]);

  // The choice replaced the name without typing: its old suggestions are gone.
  await expect(athlete).toHaveValue("Ann Smith");
  await athlete.focus();
  await athlete.press("ArrowDown");
  await expect(listbox).toBeHidden();
  await expect(page.locator(".athlete-suggestions")).toBeHidden();
  await expect(athlete).toHaveAttribute("aria-expanded", "false");
});

test("a cut list of matching athletes asks to type more of the name", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeSuggestions(page);
  await routeWrapped(page, () => ({ kind: "ambiguous", names: ["Ann Lee"], truncated: true }));
  await page.goto("/wrapped");
  await build(page, "an");
  await expect(page.locator("p.data-status")).toHaveText("Many athletes match an. Pick one, or type more of the name.");
  await expect(page.getByRole("group", { name: "Matching athletes" }).getByRole("button")).toHaveText(["Ann Lee"]);
});

for (const [kind, answer, message] of [
  ["narrow", { kind: "narrow" }, "Could not build wrapped: Too many athletes match Sm. Type more of the name."],
  [
    "tooManyResults",
    { kind: "tooManyResults", name: "Sam Smith" },
    "Could not build wrapped: Sam Smith has more 2026 results than one search returns, so a Wrapped would miss some.",
  ],
  ["none", { kind: "none", suggestions: ["Sam Smith", "Sm Lee"] }, "Could not build wrapped: No 2026 results found for Sm. Try: Sam Smith, Sm Lee."],
] as const) {
  test(`a ${kind} answer says why there is no Wrapped`, async ({ page }) => {
    await mockSubscribedUser(page);
    await routeSuggestions(page);
    await routeWrapped(page, () => answer);
    await page.goto("/wrapped");
    await build(page, "Sm");
    await expect(page.locator(".data-status.error")).toHaveText(message);
    await expect(page.locator(".data-metric-grid")).toHaveCount(0);
  });
}

test("a signed-out visitor builds a Wrapped without the subscription gate or a pass", async ({ page }) => {
  const { passRequests } = await mockAuth(page, { signedIn: false });
  await routeSuggestions(page);
  const calls = await routeWrapped(page, () => ({ kind: "athlete", name: "Test Athlete", stats }));
  await page.goto("/wrapped");
  await expect(page.getByRole("heading", { level: 1, name: "Athlete Wrapped" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to continue" })).toHaveCount(0);
  await build(page, "Test Athlete");
  await expect(page.getByRole("heading", { name: "2026 Wrapped — Test Athlete" })).toBeVisible();
  expect(calls).toEqual([{ query: "Test Athlete", year: 2026 }]);
  expect(passRequests).toEqual([]);
});
