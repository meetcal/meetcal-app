import { expect, test, type Page } from "@playwright/test";
import { mockSubscribedUser, routeQuery, valueAnswer } from "./support/api";

const result = (name: string, meet: string) => ({
  name,
  meet,
  date: "2026-06-20",
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
  adaptive: false,
});

/** `results:search` for a few athletes: exact names, a "Smith" fallback, and nothing else. */
async function routeSearch(page: Page) {
  await routeQuery(page, "results:search", (route, args) => {
    const query = String(args.query ?? "");
    if (!("startDate" in args)) {
      return route.fulfill(valueAnswer({ matched_name: null, suggestions: [], results: [] }));
    }
    const exact: Record<string, string> = {
      "ann lee": "Ann Lee",
      "bo kim": "Bo Kim",
      "amelia  phillips": "Amelia Phillips",
      "john smith": "John Smith",
      "jane smith": "Jane Smith",
    };
    const stored = exact[query.toLowerCase()];
    if (stored) {
      return route.fulfill(valueAnswer({ matched_name: query, suggestions: [], results: [result(stored, `${stored} Open`)] }));
    }
    if (query === "Smith") {
      return route.fulfill(valueAnswer({
        matched_name: null,
        suggestions: ["John Smith", "Jane Smith"],
        results: [result("John Smith", "John Smith Open"), result("Jane Smith", "Jane Smith Open")],
      }));
    }
    return route.fulfill(valueAnswer({ matched_name: null, suggestions: ["Ann Lee"], results: [] }));
  });
}

test("the Results page follows its URL: links, the header link, searches, back and forward", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeSearch(page);

  await page.goto("/results?athlete=Ann%20Lee");
  await expect(page.getByText("Results for Ann Lee")).toBeVisible();
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  await expect(athleteSearch).toHaveValue("Ann Lee");

  // A new search is a new address, so reloading or sharing it shows that athlete.
  await athleteSearch.fill("Bo Kim");
  await athleteSearch.press("Enter");
  await expect(page).toHaveURL(/\/results\?athlete=Bo%20Kim$/);
  await expect(page.getByText("Results for Bo Kim")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/results\?athlete=Ann%20Lee$/);
  await expect(page.getByText("Results for Ann Lee")).toBeVisible();
  await expect(athleteSearch).toHaveValue("Ann Lee");

  await page.goForward();
  await expect(page.getByText("Results for Bo Kim")).toBeVisible();

  // The header's Results link is an empty search.
  await page.locator('.site-nav a[href="/results"]').dispatchEvent("click");
  await expect(page).toHaveURL(/\/results$/);
  await expect(page.getByText("Enter an athlete name to search.")).toBeVisible();
  await expect(athleteSearch).toHaveValue("");
});

test("a search matching several athletes offers them instead of merging their results", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeSearch(page);

  await page.goto("/results?athlete=Smith");
  await expect(page.getByText("No athlete is named Smith exactly.", { exact: false })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  const choices = page.getByRole("group", { name: "Matching athletes" }).getByRole("link");
  await expect(choices).toHaveText(["Jane Smith", "John Smith"]);

  await choices.filter({ hasText: "John Smith" }).click();
  await expect(page).toHaveURL(/\/results\?athlete=John%20Smith$/);
  await expect(page.getByText("Results for John Smith")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("John Smith Open");
});

test("a search with no results says so and offers names to try", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeSearch(page);

  await page.goto("/results?athlete=zzqx");
  await expect(page.getByText("No results found for zzqx.")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("link", { name: "Ann Lee" }).click();
  await expect(page.getByText("Results for Ann Lee")).toBeVisible();
});

test("an exact match is headed with the athlete's name, not the search's typing", async ({ page }) => {
  await mockSubscribedUser(page);
  await routeSearch(page);

  await page.goto("/results?athlete=amelia%20%20PHILLIPS");
  await expect(page.getByText("Results for Amelia Phillips")).toBeVisible();
  await expect(page.locator(".data-status strong")).toHaveText("Amelia Phillips", { useInnerText: true });
});

for (const [path, prompt] of [
  ["/results", "Enter an athlete name to search."],
  ["/wrapped", "Enter an athlete to build their yearly recap."],
]) {
  test(`${path} with nothing asked shows its prompt without a loading skeleton`, async ({ page }) => {
    await mockSubscribedUser(page);
    await page.addInitScript(() => {
      const seen = { skeleton: false };
      (window as unknown as { __seen: typeof seen }).__seen = seen;
      new MutationObserver(() => {
        if (document.querySelector('[aria-label="Loading data"]')) seen.skeleton = true;
      }).observe(document, { childList: true, subtree: true });
    });

    await page.goto(path);
    await expect(page.getByText(prompt)).toBeVisible();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as unknown as { __seen: { skeleton: boolean } }).__seen.skeleton)).toBe(false);
  });
}
