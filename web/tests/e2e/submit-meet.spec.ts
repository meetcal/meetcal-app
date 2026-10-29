import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { errorAnswer, mockAuth, routeMutation, valueAnswer } from "./support/api";

// `/submit-meet` sends a meet's schedule and start lists
// (convex/meetSubmissions.ts): a signed-in user, no subscription, one upload
// URL per file, each file posted to its URL, then the submission.

type Call = { args: Record<string, unknown>; authorization: string | undefined };
type Upload = { token: string; contentType: string | undefined; body: string };

const UPLOAD_URL = "https://disciplined-hare-790.convex.cloud/api/storage/upload";

/**
 * Mocks the two mutations and the upload URL. `submit` is the status
 * `meetSubmissions:submit` answers (200 or a function error's, with
 * `submitError` as its text); `holdUpload` makes the upload with that token
 * wait until `release()`. Returns every call.
 */
async function mockSubmissions(
  page: Page,
  { submit = 200, submitError = "", holdUpload = "" } = {},
) {
  const calls = { uploadUrls: [] as Call[], uploads: [] as Upload[], submits: [] as Call[] };
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await routeMutation(page, "meetSubmissions:generateUploadUrl", (route, args) => {
    calls.uploadUrls.push({ args, authorization: route.request().headers().authorization });
    return route.fulfill(valueAnswer({ uploadUrl: `${UPLOAD_URL}?token=t${calls.uploadUrls.length}` }));
  });
  await page.route(`${UPLOAD_URL}?**`, async (route) => {
    const request = route.request();
    const cors = { "access-control-allow-origin": "*" };
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" },
      });
      return;
    }
    const token = new URL(request.url()).searchParams.get("token") ?? "";
    calls.uploads.push({ token, contentType: request.headers()["content-type"], body: request.postData() ?? "" });
    if (token === holdUpload) await held;
    await route.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify({ storageId: `storage_${token}` }) });
  });
  await routeMutation(page, "meetSubmissions:submit", (route, args) => {
    calls.submits.push({ args, authorization: route.request().headers().authorization });
    if (submit !== 200) return route.fulfill(errorAnswer("Server Error", { status: submit, error: submitError }));
    return route.fulfill(valueAnswer({ submitted: true }));
  });
  return { calls, release: () => release() };
}

const files = (page: Page) => page.locator("#submit-files");
const heading = (page: Page) => page.getByRole("heading", { level: 1, name: "Send us a meet" });

async function fillMeet(page: Page, end = "2026-11-15") {
  await page.getByLabel("Meet name").fill("  Ohio Open  ");
  await page.getByLabel("Start date").fill("2026-11-14");
  if (end) await page.getByLabel(/End date/).fill(end);
}

const pdf = { name: "schedule.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-schedule") };
const sheet = { name: "start list.csv", mimeType: "text/csv", buffer: Buffer.from("name,session\nA,1") };

test("signed out, the page asks for sign-in instead of the form", async ({ page }) => {
  await mockAuth(page, { signedIn: false });
  const { calls } = await mockSubmissions(page);

  await page.goto("/submit-meet");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to continue" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __authMock: { signInMounts: unknown[] } }).__authMock.signInMounts.length)).toBeGreaterThan(0);
  await expect(page.getByLabel("Meet name")).toHaveCount(0);
  await expect(page.getByText(/subscription-only/i)).toHaveCount(0);
  expect(calls.uploadUrls).toEqual([]);
});

test("the header links to the page in the desktop and the mobile menu", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page.locator('header a[href="/submit-meet"]')).toHaveCount(2);
  if (isMobile) {
    await page.getByLabel("Open navigation menu").click();
    await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Submit a Meet" }).click();
  } else {
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Submit a Meet" }).click();
  }
  await expect(page).toHaveURL(/\/submit-meet$/);
});

test("a meet uploads each file in turn, then submits", async ({ page }) => {
  await mockAuth(page);
  const { calls, release } = await mockSubmissions(page, { holdUpload: "t2" });

  await page.goto("/submit-meet");
  await expect(heading(page)).toBeVisible();
  await fillMeet(page);
  await files(page).setInputFiles([pdf, sheet]);
  const list = page.getByRole("list", { name: "Chosen files" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("schedule.pdf");
  await expect(list).toContainText("start list.csv");

  await page.getByRole("button", { name: "Submit meet" }).click();
  // The second upload waits: the page says where it is and takes no second tap.
  await expect(page.getByRole("status")).toHaveText("Uploading 2 of 2…");
  await expect(page.getByRole("button", { name: "Sending…" })).toBeDisabled();
  expect(calls.uploadUrls).toHaveLength(2);
  release();

  await expect(page.getByRole("heading", { level: 1, name: "Thanks! We’ll add it soon." })).toBeVisible();
  expect(calls.uploadUrls.map(({ authorization }) => authorization)).toEqual(["Bearer token_user_ci", "Bearer token_user_ci"]);
  expect(calls.uploads).toEqual([
    { token: "t1", contentType: "application/pdf", body: "%PDF-schedule" },
    { token: "t2", contentType: "text/csv", body: "name,session\nA,1" },
  ]);
  expect(calls.submits).toEqual([
    {
      authorization: "Bearer token_user_ci",
      args: {
        meetName: "Ohio Open",
        startDate: "2026-11-14",
        endDate: "2026-11-15",
        contactEmail: "user_ci@example.com",
        files: [
          { storageId: "storage_t1", name: "schedule.pdf" },
          { storageId: "storage_t2", name: "start list.csv" },
        ],
      },
    },
  ]);

  // Another meet starts from an empty form.
  await page.getByRole("button", { name: "Send another meet" }).click();
  await expect(heading(page)).toBeVisible();
  await expect(page.getByLabel("Meet name")).toHaveValue("");
  await expect(page.getByRole("list", { name: "Chosen files" })).toHaveCount(0);
});

test("the end date is optional and goes as null", async ({ page }) => {
  await mockAuth(page);
  const { calls } = await mockSubmissions(page);

  await page.goto("/submit-meet");
  await fillMeet(page, "");
  await files(page).setInputFiles(pdf);
  await page.getByRole("button", { name: "Submit meet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thanks! We’ll add it soon." })).toBeVisible();
  expect(calls.submits[0].args.endDate).toBeNull();
});

test("the form is checked before anything uploads", async ({ page }) => {
  await mockAuth(page);
  const { calls } = await mockSubmissions(page);
  const submit = page.getByRole("button", { name: "Submit meet" });
  const alert = page.getByRole("alert");

  await page.goto("/submit-meet");
  await submit.click();
  await expect(alert).toHaveText("Enter the meet’s name.");

  await fillMeet(page, "2026-11-13");
  await submit.click();
  await expect(alert).toHaveText("The end date can’t be before the start date.");

  await page.getByLabel(/End date/).fill("2026-11-15");
  await submit.click();
  await expect(alert).toHaveText("Add at least one schedule or start list.");

  // A file the server would refuse is marked in the list and named in the error.
  await files(page).setInputFiles([pdf, { name: "results.zip", mimeType: "application/zip", buffer: Buffer.from("zip") }]);
  const zip = page.getByRole("listitem").filter({ hasText: "results.zip" });
  await expect(zip).toContainText("Only PDFs, photos, spreadsheets and Word documents can be sent");
  await submit.click();
  await expect(alert).toHaveText("results.zip: Only PDFs, photos, spreadsheets and Word documents can be sent.");
  expect(calls.uploadUrls).toEqual([]);

  // Removing it clears the way.
  await page.getByRole("button", { name: "Remove results.zip" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await submit.click();
  await expect(page.getByRole("heading", { level: 1, name: "Thanks! We’ll add it soon." })).toBeVisible();
  expect(calls.uploadUrls).toHaveLength(1);
});

test("a refused submission shows why and keeps the form filled", async ({ page }) => {
  await mockAuth(page);
  const { calls } = await mockSubmissions(page, { submit: 429, submitError: "at most 5 meet submissions a day" });

  await page.goto("/submit-meet");
  await fillMeet(page);
  await files(page).setInputFiles(pdf);
  await page.getByRole("button", { name: "Submit meet" }).click();
  await expect(page.getByRole("alert")).toHaveText("At most 5 meet submissions a day. Please try again tomorrow.");
  await expect(page.getByLabel("Meet name")).toHaveValue("  Ohio Open  ");
  await expect(page.getByLabel("Start date")).toHaveValue("2026-11-14");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Submit meet" })).toBeEnabled();
  expect(calls.submits).toHaveLength(1);
});

test("the form has no serious accessibility violations", async ({ page }) => {
  await mockAuth(page);
  await mockSubmissions(page);
  await page.goto("/submit-meet");
  await expect(heading(page)).toBeVisible();
  await files(page).setInputFiles([pdf, { name: "results.zip", mimeType: "application/zip", buffer: Buffer.from("zip") }]);
  await page.getByRole("button", { name: "Submit meet" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const material = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(material).toEqual([]);
});

test("the form fits a small phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only layout assertion");
  await mockAuth(page);
  await mockSubmissions(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/submit-meet");
  await expect(heading(page)).toBeVisible();
  await files(page).setInputFiles({ ...pdf, name: `${"a-very-long-file-name-".repeat(6)}.pdf` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  const remove = await page.getByRole("button", { name: /^Remove / }).boundingBox();
  expect(remove?.height).toBeGreaterThanOrEqual(44);
});
