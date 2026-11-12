import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { errorAnswer, mockAuth, routeAction, routeMutation, routeQuery, valueAnswer } from "./support/api";

const MEET = "Turkey Cup";
const ENTRIES_URL = "https://usaweightlifting.sport80.com/public/events/15084/entries/21962";

type Edit = { kind: string; athlete?: string; toSession?: number; toPlatform?: string; session?: number; withSession?: number; date?: string; startTime?: string };
type Options = { days: { date: string; firstStart: string }[]; sessionMinutes: number; platforms: string[]; [key: string]: unknown };
type Call = { args: Record<string, unknown>; authorization: string | undefined };

const defaultOptions: Options = {
  days: [{ date: "2026-11-21", firstStart: "09:00" }],
  sessionMinutes: 120,
  breakMinutes: 0,
  weighInMinutes: 120,
  maxAthletesPerPlatform: 15,
  maxSessionsPerDay: null,
  platforms: ["Red"],
  grouping: "weightClass",
  separateAgeGroups: true,
  order: "womenThenMen",
};

const athlete = (key: string, name: string, weightClass: string, entryTotal: number) => ({
  key,
  memberId: key.split("|")[0],
  name,
  age: 15,
  club: "Lion Chaser Barbell",
  gender: "Female",
  weightClass,
  entryTotal,
});

function schedule(edits: Edit[]) {
  const first = [athlete("1|laney johnson", "Laney Johnson", "45", 60), athlete("2|ava smith", "Ava Smith", "53", 90)];
  const second = [athlete("3|mia lee", "Mia Lee", "77", 120)];
  for (const edit of edits) {
    if (edit.kind === "moveAthlete" && edit.toSession === 2) {
      const at = first.findIndex((a) => a.key === edit.athlete);
      if (at >= 0) second.push(...first.splice(at, 1));
    }
  }
  const retimed = edits.find((edit) => edit.kind === "setSessionTime");
  return {
    athletes: 3,
    sessions: [
      {
        id: 1,
        number: 1,
        date: "2026-11-21",
        startTime: retimed ? `${retimed.startTime}:00` : "09:00:00",
        weighInTime: "07:00:00",
        groups: [{ platform: "Red", gender: "Female", ageGroup: "youth", split: "", label: "W 45, 53 (Youth)", weightClasses: ["45", "53"], athletes: first }],
      },
      {
        id: 2,
        number: 2,
        date: "",
        startTime: "",
        weighInTime: "",
        groups: [{ platform: "Red", gender: "Female", ageGroup: "masters", split: "", label: "W 77 (Masters)", weightClasses: ["77"], athletes: second }],
      },
    ],
    warnings: [{ code: "unscheduled", message: "1 session did not fit in the meet's days." }],
  };
}

async function mockBuilder(page: Page, { signedIn = false, loadError = "" } = {}) {
  await mockAuth(page, { signedIn });
  const calls = {
    loads: [] as Call[],
    previews: [] as Call[],
    exports: [] as Call[],
    saves: [] as Call[],
    publishes: [] as Call[],
    publications: [] as Call[],
    deletes: [] as Call[],
  };
  const record = (list: Call[], route: { request(): { headers(): Record<string, string> } }, args: Record<string, unknown>) =>
    list.push({ args, authorization: route.request().headers().authorization });
  await routeAction(page, "scheduleBuilderLoad:load", (route, args) => {
    record(calls.loads, route, args);
    if (loadError) return route.fulfill(errorAnswer("Server Error", { status: 422, error: loadError }));
    return route.fulfill(valueAnswer({ meet: MEET, refreshed: true }));
  });
  await routeQuery(page, "scheduleBuilder:defaults", (route) =>
    route.fulfill(valueAnswer({ meet: MEET, startDate: "2026-11-21", endDate: "2026-11-21", timeZone: "America/Chicago", status: "upcoming", options: defaultOptions })),
  );
  await routeQuery(page, "scheduleBuilder:preview", (route, args) => {
    record(calls.previews, route, args);
    return route.fulfill(valueAnswer(schedule(args.edits as Edit[])));
  });
  await routeQuery(page, "scheduleBuilder:exportFile", (route, args) => {
    record(calls.exports, route, args);
    if (args.format === "csv") {
      return route.fulfill(valueAnswer({ fileName: "turkey-cup-schedule.csv", contentType: "text/csv; charset=utf-8", encoding: "utf8", content: "Session,Platform\r\n1,Red" }));
    }
    return route.fulfill(
      valueAnswer({
        fileName: "turkey-cup-schedule.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        encoding: "base64",
        content: Buffer.from("PK\u0003\u0004workbook").toString("base64"),
      }),
    );
  });
  await routeQuery(page, "scheduleBuilder:draft", (route) => route.fulfill(valueAnswer(null)));
  await routeQuery(page, "scheduleBuilder:drafts", (route) =>
    route.fulfill(valueAnswer(calls.deletes.length > 0 ? [] : [{ meet: MEET, updatedAt: Date.UTC(2026, 10, 10) }])),
  );
  await routeMutation(page, "scheduleBuilder:saveDraft", (route, args) => {
    record(calls.saves, route, args);
    return route.fulfill(valueAnswer({ meet: MEET, updatedAt: Date.now() }));
  });
  await routeMutation(page, "scheduleBuilder:deleteDraft", (route, args) => {
    record(calls.deletes, route, args);
    return route.fulfill(valueAnswer({ deleted: true }));
  });
  await routeMutation(page, "schedulePublications:publish", (route, args) => {
    record(calls.publishes, route, args);
    return route.fulfill(valueAnswer({ status: "pending", sessions: 2, athletes: 3 }));
  });
  await routeQuery(page, "schedulePublications:publications", (route, args) => {
    record(calls.publications, route, args);
    const publications = calls.publishes.map((_, i) => ({ id: `pub_${i}`, status: "pending", createdAt: Date.UTC(2026, 10, 12), decidedAt: null }));
    return route.fulfill(valueAnswer({ organizer: false, publications }));
  });
  return calls;
}

async function loadAndBuild(page: Page) {
  await page.goto("/schedule-builder");
  await page.getByLabel("Sport80 Entries URL").fill(ENTRIES_URL);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page).toHaveURL(/\/schedule-builder\?meet=Turkey(%20|\+)Cup$/);
  await expect(page.getByRole("heading", { level: 2, name: MEET })).toBeVisible();
  await page.getByRole("button", { name: "Build Schedule" }).click();
  await expect(page.getByTestId("schedule-board")).toBeVisible();
}

const sessionCard = (page: Page, number: number) =>
  page.locator("article.builder-session").filter({ has: page.getByRole("heading", { level: 3, name: `Session ${number}`, exact: true }) });

test("signed out, a meet loads, builds, takes an edit, exports and prints", async ({ page }) => {
  const calls = await mockBuilder(page);
  await page.addInitScript(() => {
    Object.assign(window, { __printed: 0 });
    window.print = () => {
      (window as unknown as { __printed: number }).__printed += 1;
    };
  });
  await loadAndBuild(page);

  expect(calls.loads.map((call) => call.args)).toEqual([{ url: ENTRIES_URL }]);
  expect(calls.previews.at(-1)?.args).toEqual({ meet: MEET, options: defaultOptions, edits: [] });
  expect(calls.previews.every((call) => call.authorization === undefined)).toBe(true);
  await expect(page.getByRole("list", { name: "Warnings" })).toContainText("1 session did not fit");
  await expect(sessionCard(page, 1)).toContainText("November 21, 2026 · Weigh-In 7:00 AM · Start 9:00 AM");
  await expect(sessionCard(page, 1)).toContainText("W 45, 53 (Youth)");
  await expect(sessionCard(page, 2)).toContainText("No Time");

  await page.getByRole("button", { name: "Laney Johnson: Move To…" }).click();
  await expect(page.getByRole("menu", { name: "Move To…" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Session 2 · Red" }).click();
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");
  expect(calls.previews.at(-1)?.args.edits).toEqual([{ kind: "moveAthlete", athlete: "1|laney johnson", toSession: 2, toPlatform: "Red" }]);

  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await csv).suggestedFilename()).toBe("turkey-cup-schedule.csv");
  const xlsx = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel" }).click();
  const workbook = await xlsx;
  expect(workbook.suggestedFilename()).toBe("turkey-cup-schedule.xlsx");
  const bytes = await (await workbook.createReadStream()).toArray();
  expect(Buffer.concat(bytes).toString("latin1")).toBe("PK\u0003\u0004workbook");
  expect(calls.exports.map((call) => call.args.format)).toEqual(["csv", "xlsx"]);
  expect(calls.exports.at(-1)?.args.edits).toEqual(calls.previews.at(-1)?.args.edits);

  await page.getByRole("button", { name: "Print / Save as PDF" }).click();
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header.site-header")).toBeHidden();
  await expect(page.locator(".builder-options")).toBeHidden();
  await expect(page.getByRole("button", { name: "Laney Johnson: Move To…" })).toBeHidden();
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");
  await page.emulateMedia({ media: "screen" });

  await expect(page.getByRole("button", { name: "Sign In to Publish" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(sessionCard(page, 1)).toContainText("Laney Johnson");
  expect(calls.previews.at(-1)?.args.edits).toEqual([]);

  await page.getByRole("button", { name: "Ava Smith: Move To…" }).click();
  await page.getByRole("menuitem", { name: "Session 2 · Red" }).click();
  await expect(sessionCard(page, 2)).toContainText("Ava Smith");
  await page.reload();
  await expect(sessionCard(page, 2)).toContainText("Ava Smith");
  expect(calls.previews.at(-1)?.args.edits).toEqual([{ kind: "moveAthlete", athlete: "2|ava smith", toSession: 2, toPlatform: "Red" }]);
});

test("a session can be retimed and swapped, and building again asks before dropping edits", async ({ page }) => {
  const calls = await mockBuilder(page);
  await loadAndBuild(page);

  await page.getByRole("button", { name: "Session 1: Edit Time" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Time" });
  await dialog.getByLabel("Start Time").fill("10:30");
  await dialog.getByRole("button", { name: "Save Time" }).click();
  await expect(sessionCard(page, 1)).toContainText("Start 10:30 AM");

  await page.getByRole("button", { name: "Session 1: Swap With…" }).click();
  await page.getByRole("menuitem", { name: /^Session 2 · No Time$/ }).click();
  await expect.poll(() => calls.previews.at(-1)?.args.edits).toEqual([
    { kind: "setSessionTime", session: 1, date: "2026-11-21", startTime: "10:30" },
    { kind: "swapSessions", session: 1, withSession: 2 },
  ]);

  await page.getByRole("button", { name: "Move Class: 45kg" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.getByLabel("Session Length (Minutes)").fill("90");
  await page.getByRole("button", { name: "Build Again" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Building again discards your 2 edits.");
  await page.getByRole("button", { name: "Keep Editing" }).click();
  expect(calls.previews.at(-1)?.args.edits).toHaveLength(2);
  await page.getByRole("button", { name: "Build Again" }).click();
  await page.getByRole("button", { name: "Discard Edits and Build" }).click();
  await expect.poll(() => calls.previews.at(-1)?.args).toEqual({ meet: MEET, options: { ...defaultOptions, sessionMinutes: 90 }, edits: [] });

  await page.getByLabel("Session Length (Minutes)").fill("5");
  await page.getByRole("button", { name: "Build Again" }).click();
  await expect(page.getByRole("alert")).toContainText("Session length must be a whole number from 15 to 480.");
});

test("a load Sport80 refuses shows the server's reason", async ({ page }) => {
  await mockBuilder(page, { loadError: "Sport80 hasn't set this meet's dates yet" });
  await page.goto("/schedule-builder");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Paste the meet’s Sport80 entries URL.");
  await page.getByLabel("Sport80 Entries URL").fill(ENTRIES_URL);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Sport80 hasn't set this meet's dates yet");
  await expect(page).toHaveURL(/\/schedule-builder$/);
});

test("signed in, drafts save and list, and a publish is sent for review", async ({ page }) => {
  const calls = await mockBuilder(page, { signedIn: true });
  await page.goto("/schedule-builder");
  const drafts = page.getByRole("region", { name: "Saved Schedules" });
  await expect(drafts.getByRole("link", { name: MEET })).toHaveAttribute("href", "/schedule-builder?meet=Turkey%20Cup");

  await loadAndBuild(page);
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
  expect(calls.saves).toEqual([{ args: { meet: MEET, options: defaultOptions, edits: [] }, authorization: "Bearer token_user_ci" }]);

  const publish = page.getByRole("region", { name: "Publish to MeetCal" });
  await expect(publish.getByLabel("Contact Email")).toHaveValue("user_ci@example.com");
  await expect(publish).toContainText("A meet’s first publish is reviewed before it goes live");
  await publish.getByRole("button", { name: "Publish" }).click();
  await expect(publish.getByRole("heading", { name: "Sent for Review" })).toBeVisible();
  await expect(publish.getByRole("status")).toContainText("2 sessions and 3 athletes");
  expect(calls.publishes).toEqual([
    { args: { meet: MEET, options: defaultOptions, edits: [], contactEmail: "user_ci@example.com" }, authorization: "Bearer token_user_ci" },
  ]);
  await expect(publish.getByText("In Review")).toBeVisible();
  expect(calls.publications.every((call) => call.authorization === "Bearer token_user_ci")).toBe(true);

  await page.getByRole("link", { name: "Load Another Meet" }).click();
  await drafts.getByRole("button", { name: `Delete the saved schedule for ${MEET}` }).click();
  await expect(drafts).toContainText("No saved schedules yet.");
  expect(calls.deletes.map((call) => call.args)).toEqual([{ meet: MEET }]);
});

test("the built schedule has no detectable accessibility violations", async ({ page }) => {
  await mockBuilder(page);
  await loadAndBuild(page);
  await page.getByRole("button", { name: "Laney Johnson: Move To…" }).click();
  const results = await new AxeBuilder({ page }).include(".builder-page").analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("the header links to the Schedule Builder for everyone", async ({ page }) => {
  await mockAuth(page, { signedIn: false });
  await page.goto("/");
  await expect(page.locator('header a[href="/schedule-builder"]')).toHaveCount(2);
});
