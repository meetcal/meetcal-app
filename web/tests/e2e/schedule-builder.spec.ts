import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { errorAnswer, mockAuth, routeAction, routeMutation, routeQuery, valueAnswer } from "./support/api";

const MEET = "Turkey Cup";
const ENTRIES_URL = "https://usaweightlifting.sport80.com/public/events/15084/entries/21962";
const MEET_PAGE_URL = "https://usaweightlifting.sport80.com/public/events/15084";

type Edit = { kind: string; athlete?: string; fromSession?: number; fromPlatform?: string; occurrence?: number; toSession?: number; toPlatform?: string; session?: number; withSession?: number; date?: string; startTime?: string };
type Options = { days: { date: string; firstStart: string }[]; sessionMinutes: number; platforms: string[]; [key: string]: unknown };
type Call = { args: Record<string, unknown>; authorization: string | undefined };

const defaultOptions: Options = {
  days: [{ date: "2026-11-21", firstStart: "09:00" }],
  sessionMinutes: 120,
  breakMinutes: 0,
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

type Shape = { secondDay?: string; twins?: boolean };

function schedule(edits: Edit[], { secondDay, twins = false }: Shape = {}) {
  const first = [athlete("1|laney johnson", "Laney Johnson", "45", 60), athlete("2|ava smith", "Ava Smith", "53", 90)];
  const second = [athlete("3|mia lee", "Mia Lee", "77", 120)];
  if (twins) second.push(athlete("3|mia lee", "Mia Lee", "77", 125));
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
        date: secondDay ?? "",
        startTime: secondDay ? "09:00:00" : "",
        weighInTime: secondDay ? "07:00:00" : "",
        groups: [{ platform: "Red", gender: "Female", ageGroup: "masters", split: "", label: "W 77 (Masters)", weightClasses: ["77"], athletes: second }],
      },
    ],
    warnings: [{ code: "unscheduled", message: "1 session did not fit in the meet's days." }],
  };
}

const FLIGHT_TIMES = "W 77 · Weigh-In 9:00 AM · Start 11:00 AM\nW 87 · Weigh-In 10:00 AM · Start 12:00 PM";

type Match = { eventId: string; name: string; startDate: string; endDate: string; place: string; entriesUrl: string | null };
function publishedBoard(edits: Edit[], checkedAt: number, locked = false) {
  const board = schedule(edits.filter((edit) => edit.kind === "moveAthlete"));
  const newcomer = athlete("9|ella late", "Ella Late", "53", 110);
  const add = edits.find((edit) => edit.kind === "addAthlete" && edit.athlete === newcomer.key);
  const removed = edits.some((edit) => edit.kind === "removeAthlete" && edit.athlete === "2|ava smith");
  const sessions = board.sessions.map((session) => {
    const groups = session.groups.map((group) => {
      const kept = group.athletes.filter((a) => !(removed && a.key === "2|ava smith")).map((a) => (a.key === "2|ava smith" ? { ...a, withdrawn: true } : a));
      const ownTimes = session.id === 2 ? FLIGHT_TIMES : null;
      return { ...group, ownTimes, locked: locked && session.id === 2, athletes: add?.toSession === session.id ? [...kept, newcomer] : kept };
    });
    return { ...session, lockedPlatforms: locked && session.id === 2 ? ["Red"] : [], date: "2026-11-21", startTime: session.startTime || "11:00:00", weighInTime: session.weighInTime || "09:00:00", groups };
  });
  const withdrawn = removed ? [] : [{ athlete: { ...athlete("2|ava smith", "Ava Smith", "53", 90), withdrawn: true }, place: { session: 1, number: 1, platform: "Red" }, occurrence: 0 }];
  return {
    athletes: 3,
    sessions,
    warnings: [],
    changes: {
      checkedAt,
      added: add ? [] : [{ athlete: newcomer, suggestion: { session: 1, number: 1, platform: "Red" } }],
      withdrawn,
      addedNote: add ? "Every new lifter is placed." : "1 new lifter isn’t placed, so they stay off the start list when you publish.",
      withdrawnNote: removed ? "1 lifter comes off the start list when you publish." : "1 lifter is marked on the board. Remove takes them off the start list when you publish.",
    },
  };
}

type MockSetup = Shape & { published?: boolean; locked?: boolean; signedIn?: boolean; loadError?: string; refuseSessionMinutes?: number[]; matches?: Match[]; truncated?: boolean };

async function mockBuilder(page: Page, { published = false, locked = false, signedIn = false, loadError = "", refuseSessionMinutes = [], matches = [], truncated = false, ...shape }: MockSetup = {}) {
  const meetDays = shape.secondDay ? ["2026-11-21", shape.secondDay] : ["2026-11-21"];
  const options = { ...defaultOptions, days: meetDays.map((date) => ({ date, firstStart: "09:00" })) };
  await mockAuth(page, { signedIn });
  const calls = {
    loads: [] as Call[],
    searches: [] as Call[],
    previews: [] as Call[],
    exports: [] as Call[],
    saves: [] as Call[],
    publishes: [] as Call[],
    publications: [] as Call[],
    deletes: [] as Call[],
    sport80: { checkedAt: Date.UTC(2026, 10, 12, 15) },
  };
  const record = (list: Call[], route: { request(): { headers(): Record<string, string> } }, args: Record<string, unknown>) =>
    list.push({ args, authorization: route.request().headers().authorization });
  await routeAction(page, "scheduleBuilderLoad:load", (route, args) => {
    record(calls.loads, route, args);
    if (loadError) return route.fulfill(errorAnswer("Server Error", { status: 422, error: loadError }));
    return route.fulfill(valueAnswer({ meet: MEET, refreshed: true }));
  });
  await routeAction(page, "scheduleBuilderLoad:search", (route, args) => {
    record(calls.searches, route, args);
    return route.fulfill(valueAnswer({ results: matches, truncated }));
  });
  await routeQuery(page, "scheduleBuilder:defaults", (route) =>
    route.fulfill(
      valueAnswer({
        meet: MEET,
        startDate: "2026-11-21",
        endDate: meetDays.at(-1),
        timeZone: "America/Chicago",
        status: "upcoming",
        options,
        sport80Link: MEET_PAGE_URL,
        published: published ? { version: "pub_1", options } : null,
      }),
    ),
  );
  await routeQuery(page, "scheduleBuilder:preview", (route, args) => {
    record(calls.previews, route, args);
    if (refuseSessionMinutes.includes((args.options as Options).sessionMinutes)) {
      return route.fulfill(errorAnswer("Server Error", { status: 400, error: "the first session on 2026-11-21 would end after midnight" }));
    }
    if (args.base === "published") return route.fulfill(valueAnswer(publishedBoard(args.edits as Edit[], calls.sport80.checkedAt, locked)));
    return route.fulfill(valueAnswer(schedule(args.edits as Edit[], shape)));
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

async function loadAndBuild(page: Page, link = ENTRIES_URL) {
  await page.goto("/schedule-builder");
  await page.getByLabel("Sport80 Link or Meet Name").fill(link);
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
  expect(calls.previews.at(-1)?.args).toEqual({ meet: MEET, options: defaultOptions, edits: [], base: "entries" });
  expect(calls.previews.every((call) => call.authorization === undefined)).toBe(true);
  await expect(page.getByRole("list", { name: "Warnings" })).toContainText("1 session did not fit");
  await expect(sessionCard(page, 1)).toContainText("November 21, 2026 · Weigh-In 7:00 AM · Start 9:00 AM");
  await expect(sessionCard(page, 1)).toContainText("W 45, 53 (Youth)");
  await expect(sessionCard(page, 2)).toContainText("No Time");

  await page.getByRole("button", { name: "Laney Johnson: Move To…" }).click();
  await expect(page.getByRole("button", { name: "Laney Johnson: Move To…" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 2 · Red" }).click();
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");
  expect(calls.previews.at(-1)?.args.edits).toEqual([{ kind: "moveAthlete", athlete: "1|laney johnson", fromSession: 1, fromPlatform: "Red", occurrence: 0, toSession: 2, toPlatform: "Red" }]);

  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  const exports = page.getByRole("group", { name: "Export" });
  const exportStatus = page.locator(".builder-toolbar").getByRole("status");
  await expect(exportStatus).toBeAttached();
  await expect(exportStatus).toHaveText("");
  await expect(exportButton).toHaveAttribute("aria-expanded", "false");
  await exportButton.click();
  await expect(exportButton).toHaveAttribute("aria-expanded", "true");
  await expect(exports.getByRole("button")).toHaveText(["CSV", "Excel", "PDF"]);
  const csv = page.waitForEvent("download");
  await exports.getByRole("button", { name: "CSV" }).click();
  expect((await csv).suggestedFilename()).toBe("turkey-cup-schedule.csv");
  await expect(exports).toHaveCount(0);
  await expect(exportButton).toBeFocused();
  const xlsx = page.waitForEvent("download");
  await exportButton.click();
  await exports.getByRole("button", { name: "Excel" }).click();
  const workbook = await xlsx;
  expect(workbook.suggestedFilename()).toBe("turkey-cup-schedule.xlsx");
  const bytes = await (await workbook.createReadStream()).toArray();
  expect(Buffer.concat(bytes).toString("latin1")).toBe("PK\u0003\u0004workbook");
  expect(calls.exports.map((call) => call.args.format)).toEqual(["csv", "xlsx"]);
  expect(calls.exports.at(-1)?.args.edits).toEqual(calls.previews.at(-1)?.args.edits);

  await exportButton.click();
  await exports.getByRole("button", { name: "PDF" }).click();
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  await expect(exports).toHaveCount(0);
  expect(calls.exports).toHaveLength(2);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header.site-header")).toBeHidden();
  await expect(page.locator(".builder-options")).toBeHidden();
  await expect(page.getByRole("button", { name: "Laney Johnson: Move To…" })).toBeHidden();
  await expect(exportButton).toBeHidden();
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");
  await page.emulateMedia({ media: "screen" });

  await expect(page.getByRole("button", { name: "Sign In to Publish" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(sessionCard(page, 1)).toContainText("Laney Johnson");
  expect(calls.previews.at(-1)?.args.edits).toEqual([]);

  await page.getByRole("button", { name: "Ava Smith: Move To…" }).click();
  await page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 2 · Red" }).click();
  await expect(sessionCard(page, 2)).toContainText("Ava Smith");
  await page.reload();
  await expect(sessionCard(page, 2)).toContainText("Ava Smith");
  expect(calls.previews.at(-1)?.args.edits).toEqual([{ kind: "moveAthlete", athlete: "2|ava smith", fromSession: 1, fromPlatform: "Red", occurrence: 0, toSession: 2, toPlatform: "Red" }]);
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
  await page.getByRole("group", { name: "Swap With…" }).getByRole("button", { name: /^Session 2 · No Time$/ }).click();
  await expect.poll(() => calls.previews.at(-1)?.args.edits).toEqual([
    { kind: "setSessionTime", session: 1, date: "2026-11-21", startTime: "10:30" },
    { kind: "swapSessions", session: 1, withSession: 2 },
  ]);

  await expect(page.getByRole("button", { name: "Move Class: 45", exact: true })).toHaveText("Move Class: 45");
  await page.getByRole("button", { name: "Move Class: 45", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Move Class To…" })).toHaveCount(0);

  await page.getByLabel("Session Length (Minutes)").fill("90");
  await page.getByRole("button", { name: "Build Again" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Building again discards your 2 edits.");
  await expect(page.getByRole("button", { name: "Keep Editing" })).toBeFocused();
  await page.getByRole("button", { name: "Keep Editing" }).click();
  await expect(page.getByRole("button", { name: "Build Again" })).toBeFocused();
  expect(calls.previews.at(-1)?.args.edits).toHaveLength(2);
  await page.getByRole("button", { name: "Build Again" }).click();
  await page.getByRole("button", { name: "Discard Edits and Build" }).click();
  await expect.poll(() => calls.previews.at(-1)?.args).toEqual({ meet: MEET, options: { ...defaultOptions, sessionMinutes: 90 }, edits: [], base: "entries" });

  await page.getByLabel("Session Length (Minutes)").fill("5");
  await page.getByRole("button", { name: "Build Again" }).click();
  await expect(page.getByRole("alert")).toContainText("Session length must be a whole number from 15 to 480.");

  await page.getByLabel("Session Length (Minutes)").fill("120");
  await page.getByLabel("First start on November 21, 2026").fill("01:59");
  await page.getByRole("button", { name: "Build Again" }).click();
  await expect(page.getByRole("alert")).toHaveText("The first start on November 21, 2026 leaves no time for its weigh-in 2 hours before.");
  await page.getByLabel("First start on November 21, 2026").fill("23:00");
  await page.getByRole("button", { name: "Build Again" }).click();
  await expect(page.getByRole("alert")).toHaveText("The first session on November 21, 2026 would end after midnight.");
  expect(calls.previews.at(-1)?.args.options).toEqual({ ...defaultOptions, sessionMinutes: 90 });
});

test("the board's menus open, choose and close from the keyboard, and focus follows", async ({ page }) => {
  const calls = await mockBuilder(page);
  await loadAndBuild(page);

  const trigger = page.getByRole("button", { name: "Laney Johnson: Move To…" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const list = page.getByRole("group", { name: "Move To…" });
  await page.keyboard.press("Tab");
  await expect(list.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(list.getByRole("button", { name: "Session 2 · Red" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");
  expect(calls.previews.at(-1)?.args.edits).toEqual([{ kind: "moveAthlete", athlete: "1|laney johnson", fromSession: 1, fromPlatform: "Red", occurrence: 0, toSession: 2, toPlatform: "Red" }]);
  await expect(page.getByRole("button", { name: "Ava Smith: Move To…" })).toBeFocused();

  await page.getByRole("button", { name: "Session 1: Edit Time" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Time" });
  await expect(dialog.getByLabel("Date")).toBeFocused();
  await dialog.getByLabel("Start Time").fill("11:00");
  await dialog.getByLabel("Start Time").press("Enter");
  await expect(sessionCard(page, 1)).toContainText("Start 11:00 AM");
  await expect(page.getByRole("button", { name: "Session 1: Edit Time" })).toBeFocused();

  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  await exportButton.focus();
  await page.keyboard.press("Enter");
  await expect(exportButton).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("group", { name: "Export" }).getByRole("button", { name: "CSV" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Export" })).toHaveCount(0);
  await expect(exportButton).toBeFocused();
  await expect(exportButton).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const xlsx = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  expect((await xlsx).suggestedFilename()).toBe("turkey-cup-schedule.xlsx");
  await expect(exportButton).toBeFocused();
  expect(calls.exports.map((call) => call.args.format)).toEqual(["xlsx"]);
});

test("the board is inert while the next answer loads", async ({ page }) => {
  await mockBuilder(page);
  await loadAndBuild(page);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await routeQuery(page, "scheduleBuilder:preview", async (route) => {
    await held;
    await route.fallback();
  });
  await page.getByRole("button", { name: "Laney Johnson: Move To…" }).click();
  await page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 2 · Red" }).click();
  await expect(page.getByTestId("schedule-board")).toHaveAttribute("inert", "");
  release();
  await expect(page.getByTestId("schedule-board")).not.toHaveAttribute("inert");
});

test("a day-2 session's Edit Time opens on day 2", async ({ page }) => {
  const calls = await mockBuilder(page, { secondDay: "2026-11-22" });
  await loadAndBuild(page);
  await expect(sessionCard(page, 2)).toContainText("November 22, 2026");

  await page.getByRole("button", { name: "Session 2: Edit Time" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Time" });
  await expect(dialog.getByLabel("Date")).toHaveValue("2026-11-22");
  await expect(dialog.getByLabel("Date").locator("option:checked")).toHaveText("November 22, 2026");
  await dialog.getByLabel("Start Time").fill("13:00");
  await dialog.getByRole("button", { name: "Save Time" }).click();
  await expect.poll(() => calls.previews.at(-1)?.args.edits).toEqual([{ kind: "setSessionTime", session: 2, date: "2026-11-22", startTime: "13:00" }]);
});

test("entrants who share an identity open their own Move To lists", async ({ page }) => {
  await mockBuilder(page, { twins: true });
  await loadAndBuild(page);
  const twins = page.getByRole("button", { name: "Mia Lee: Move To…" });
  await expect(twins).toHaveCount(2);
  await twins.first().click();
  await expect(twins.first()).toHaveAttribute("aria-expanded", "true");
  await expect(twins.last()).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("group", { name: "Move To…" })).toHaveCount(1);
});

test("a build the server refuses keeps the edits", async ({ page }) => {
  const calls = await mockBuilder(page, { refuseSessionMinutes: [100] });
  await loadAndBuild(page);
  await page.getByRole("button", { name: "Laney Johnson: Move To…" }).click();
  await page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 2 · Red" }).click();
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");

  await page.getByLabel("Session Length (Minutes)").fill("100");
  await page.getByRole("button", { name: "Build Again" }).click();
  await page.getByRole("button", { name: "Discard Edits and Build" }).click();
  await expect(page.locator(".builder-options").getByRole("alert")).toContainText("This schedule couldn’t be built, so your edits are kept");
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");
  expect(calls.previews.some((call) => (call.args.options as Options).sessionMinutes === 100)).toBe(true);
  expect(calls.previews.at(-1)?.args).toEqual({
    meet: MEET,
    options: defaultOptions,
    edits: [{ kind: "moveAthlete", athlete: "1|laney johnson", fromSession: 1, fromPlatform: "Red", occurrence: 0, toSession: 2, toPlatform: "Red" }],
    base: "entries",
  });
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("the meet's Sport80 page loads too, and the options have no weigh-in field", async ({ page }) => {
  const calls = await mockBuilder(page);
  await page.goto("/schedule-builder");
  await expect(page.getByLabel("Sport80 Link or Meet Name")).toHaveAttribute("placeholder", `Turkey Cup or ${MEET_PAGE_URL.replace("15084", "12345")}`);
  await loadAndBuild(page, MEET_PAGE_URL);
  expect(calls.loads.map((call) => call.args)).toEqual([{ url: MEET_PAGE_URL }]);
  await expect(page.getByLabel(/Weigh-In/)).toHaveCount(0);
  expect(calls.previews.at(-1)?.args.options).not.toHaveProperty("weighInMinutes");
  await expect(sessionCard(page, 1)).toContainText("Weigh-In 7:00 AM · Start 9:00 AM");
});

test("a load Sport80 refuses shows the server's reason", async ({ page }) => {
  await mockBuilder(page, { loadError: "Sport80 hasn't set this meet's dates yet" });
  await page.goto("/schedule-builder");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Type the meet’s name or paste its Sport80 link.");
  await page.getByLabel("Sport80 Link or Meet Name").fill(ENTRIES_URL);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Sport80 hasn't set this meet's dates yet");
  await expect(page).toHaveURL(/\/schedule-builder$/);
});

const TURKEY_CUP: Match = { eventId: "15084", name: MEET, startDate: "2026-11-21", endDate: "2026-11-21", place: "Saint Joseph, Missouri", entriesUrl: ENTRIES_URL };
const UNLISTED: Match = { eventId: "15090", name: "Turkey Open", startDate: "2026-12-05", endDate: "2026-12-06", place: "Austin, Texas", entriesUrl: null };

test("a meet's name searches Sport80 on Enter, and a match loads from its entries list", async ({ page }) => {
  const calls = await mockBuilder(page, { matches: [TURKEY_CUP, UNLISTED] });
  await page.goto("/schedule-builder");
  const field = page.getByLabel("Sport80 Link or Meet Name");
  await field.pressSequentially("Turkey Cup");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  expect(calls.searches).toHaveLength(0);
  await field.press("Enter");
  const matches = page.getByRole("list", { name: "Matching Meets" });
  await expect(matches.getByRole("listitem")).toHaveCount(2);
  expect(calls.searches.map((call) => call.args)).toEqual([{ query: "Turkey Cup" }]);
  await expect(matches.getByRole("listitem").first()).toContainText("November 21, 2026 · Saint Joseph, Missouri");
  await expect(matches.getByRole("listitem").last()).toContainText("December 5, 2026 – December 6, 2026 · Austin, Texas");
  const unlisted = matches.getByRole("listitem").filter({ hasText: "Turkey Open" });
  await expect(unlisted).toContainText("No Entry List Yet");
  await expect(unlisted.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("Sport80 has more matches")).toHaveCount(0);

  await matches.getByRole("button", { name: "Load Turkey Cup, November 21, 2026 · Saint Joseph, Missouri" }).click();
  await expect(page).toHaveURL(/\/schedule-builder\?meet=Turkey(%20|\+)Cup$/);
  expect(calls.loads.map((call) => call.args)).toEqual([{ url: ENTRIES_URL }]);
  expect(calls.searches).toHaveLength(1);
});

test("a search with no matches says so, and a long one says there are more", async ({ page }) => {
  await mockBuilder(page);
  await page.goto("/schedule-builder");
  await page.getByLabel("Sport80 Link or Meet Name").fill("Nowhere Open");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("No upcoming Sport80 meets match “Nowhere Open”.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Matching Meets" })).toHaveCount(0);

  await routeAction(page, "scheduleBuilderLoad:search", (route) => route.fulfill(valueAnswer({ results: [TURKEY_CUP], truncated: true })));
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("list", { name: "Matching Meets" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("Sport80 has more matches than these. Add more of the name to narrow them.")).toBeVisible();
});

test("only the latest search's answer is shown", async ({ page }) => {
  const calls = await mockBuilder(page, { matches: [TURKEY_CUP] });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let staleAnswered = false;
  await routeAction(page, "scheduleBuilderLoad:search", async (route, args) => {
    if (args.query !== "Turkey") return route.fallback();
    await held;
    await route.fulfill(valueAnswer({ results: [UNLISTED], truncated: false })).catch(() => {});
    staleAnswered = true;
  });
  await page.goto("/schedule-builder");
  const field = page.getByLabel("Sport80 Link or Meet Name");
  await field.fill("Turkey");
  await field.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Searching Sport80’s upcoming meets…" })).toBeVisible();
  await expect(page.locator(".builder-load-form")).toHaveAttribute("aria-busy", "true");
  await field.fill("Turkey Cup");
  await field.press("Enter");
  const matches = page.getByRole("list", { name: "Matching Meets" });
  await expect(matches).toContainText(MEET);
  release();
  await expect.poll(() => staleAnswered).toBe(true);
  expect(calls.searches.map((call) => call.args.query)).toEqual(["Turkey Cup"]);
  await expect(matches.getByRole("listitem")).toHaveCount(1);
  await expect(matches).not.toContainText("Turkey Open");
});

test("Build Again's options are kept on reload once its schedule is built", async ({ page }) => {
  const calls = await mockBuilder(page);
  await loadAndBuild(page);
  await page.getByRole("button", { name: "Laney Johnson: Move To…" }).click();
  await page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 2 · Red" }).click();
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");
  await page.getByLabel("Session Length (Minutes)").fill("90");
  await page.getByRole("button", { name: "Build Again" }).click();
  await page.getByRole("button", { name: "Discard Edits and Build" }).click();
  await expect.poll(() => calls.previews.at(-1)?.args).toEqual({ meet: MEET, options: { ...defaultOptions, sessionMinutes: 90 }, edits: [], base: "entries" });
  await expect(page.getByTestId("schedule-board")).not.toHaveAttribute("inert");
  await expect(sessionCard(page, 1)).toContainText("Laney Johnson");

  await page.reload();
  await expect(page.getByTestId("schedule-board")).toBeVisible();
  await expect(page.getByLabel("Session Length (Minutes)")).toHaveValue("90");
  await expect(sessionCard(page, 1)).toContainText("Laney Johnson");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(calls.previews.at(-1)?.args).toEqual({ meet: MEET, options: { ...defaultOptions, sessionMinutes: 90 }, edits: [], base: "entries" });
});

test("Move To names which of two entrants sharing an identity it moves", async ({ page }) => {
  const calls = await mockBuilder(page, { twins: true });
  await loadAndBuild(page);
  await page.getByRole("button", { name: "Mia Lee: Move To…" }).last().click();
  await page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 1 · Red" }).click();
  await expect.poll(() => calls.previews.at(-1)?.args.edits).toEqual([
    { kind: "moveAthlete", athlete: "3|mia lee", fromSession: 2, fromPlatform: "Red", occurrence: 1, toSession: 1, toPlatform: "Red" },
  ]);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Mia Lee: Move To…" }).first().click();
  await page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 1 · Red" }).click();
  await expect.poll(() => calls.previews.at(-1)?.args.edits).toEqual([
    { kind: "moveAthlete", athlete: "3|mia lee", fromSession: 2, fromPlatform: "Red", occurrence: 0, toSession: 1, toPlatform: "Red" },
  ]);
});

test("a second build while a rebuild loads still keeps the first edits when it is refused", async ({ page }) => {
  const calls = await mockBuilder(page, { refuseSessionMinutes: [100, 110] });
  await loadAndBuild(page);
  await page.getByRole("button", { name: "Laney Johnson: Move To…" }).click();
  await page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 2 · Red" }).click();
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");

  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldAnswered = false;
  await routeQuery(page, "scheduleBuilder:preview", async (route, args) => {
    if ((args.options as Options).sessionMinutes !== 100) return route.fallback();
    await held;
    await route.fallback().catch(() => {});
    heldAnswered = true;
  });
  await page.getByLabel("Session Length (Minutes)").fill("100");
  await page.getByRole("button", { name: "Build Again" }).click();
  await page.getByRole("button", { name: "Discard Edits and Build" }).click();
  await expect(page.getByTestId("schedule-board")).toHaveAttribute("inert", "");
  await page.getByLabel("Session Length (Minutes)").fill("110");
  await page.getByRole("button", { name: "Build Again" }).click();
  await expect(page.locator(".builder-options").getByRole("alert")).toContainText("This schedule couldn’t be built, so your edits are kept");
  const kept = {
    meet: MEET,
    options: defaultOptions,
    edits: [{ kind: "moveAthlete", athlete: "1|laney johnson", fromSession: 1, fromPlatform: "Red", occurrence: 0, toSession: 2, toPlatform: "Red" }],
    base: "entries",
  };
  await expect.poll(() => calls.previews.at(-1)?.args).toEqual(kept);
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  release();
  await expect.poll(() => heldAnswered).toBe(true);
  await expect(sessionCard(page, 2)).toContainText("Laney Johnson");
  await expect(page.getByLabel("Session Length (Minutes)")).toHaveValue("110");
});

test("a refused build without edits doesn't claim to keep any", async ({ page }) => {
  await mockBuilder(page, { refuseSessionMinutes: [100] });
  await loadAndBuild(page);
  await page.getByLabel("Session Length (Minutes)").fill("100");
  await page.getByRole("button", { name: "Build Again" }).click();
  const alert = page.locator(".builder-options").getByRole("alert");
  await expect(alert).toHaveText("This schedule couldn’t be built: The first session on 2026-11-21 would end after midnight");
});

test("the board takes no edits while a publish is on its way", async ({ page }) => {
  const calls = await mockBuilder(page, { signedIn: true });
  await loadAndBuild(page);
  await page.getByRole("button", { name: "Ava Smith: Move To…" }).click();
  await page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 2 · Red" }).click();
  await expect(sessionCard(page, 2)).toContainText("Ava Smith");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await routeMutation(page, "schedulePublications:publish", async (route) => {
    await held;
    await route.fallback();
  });
  const publish = page.getByRole("region", { name: "Publish to MeetCal" });
  await publish.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(publish.getByRole("button", { name: "Publishing…" })).toBeDisabled();
  await expect(page.getByTestId("schedule-board")).toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  release();
  await expect(publish.getByRole("heading", { name: "Sent for Review" })).toBeVisible();
  await expect(page.getByTestId("schedule-board")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  expect(calls.publishes.at(-1)?.args.edits).toEqual([{ kind: "moveAthlete", athlete: "2|ava smith", fromSession: 1, fromPlatform: "Red", occurrence: 0, toSession: 2, toPlatform: "Red" }]);
});

test("a platform published in several rows at their own times shows one line per row", async ({ page }) => {
  await mockBuilder(page, { signedIn: true, published: true });
  await page.goto("/schedule-builder?meet=Turkey%20Cup");
  const times = sessionCard(page, 2).locator(".builder-group-time");
  await expect(times).toBeVisible();
  expect(await times.evaluate((element) => (element as HTMLElement).innerText)).toBe(FLIGHT_TIMES);
  await expect(sessionCard(page, 1).locator(".builder-group-time")).toBeHidden();
});

test("a platform with several published rows offers no edit that would touch it", async ({ page }) => {
  await mockBuilder(page, { signedIn: true, published: true, locked: true });
  await page.goto("/schedule-builder?meet=Turkey%20Cup");
  const second = sessionCard(page, 2);
  await expect(second).toContainText("Mia Lee");
  await expect(second.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Session 2: Swap With…" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Session 2: Edit Time" })).toHaveCount(0);
  await page.getByRole("button", { name: "Session 1: Swap With…" }).click();
  await expect(page.getByRole("group", { name: "Swap With…" }).getByRole("button", { name: /^Session 2 · / })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Laney Johnson: Move To…" }).click();
  await expect(page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 2 · Red" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const changes = page.getByRole("region", { name: "Sport80 Changes" });
  await changes.getByRole("button", { name: "Ella Late: Add To…" }).click();
  await expect(page.getByRole("group", { name: "Add To…" }).getByRole("button", { name: "Session 1 · Red" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Add To…" }).getByRole("button", { name: "Session 2 · Red" })).toHaveCount(0);
});

test("a publish on its way holds Rebuild From Scratch and the Sport80 changes too", async ({ page }) => {
  const calls = await mockBuilder(page, { signedIn: true, published: true });
  await page.goto("/schedule-builder?meet=Turkey%20Cup");
  const changes = page.getByRole("region", { name: "Sport80 Changes" });
  await expect(changes).toContainText("1 new lifter isn’t placed");
  const rebuild = page.locator(".builder-options").getByRole("button", { name: "Rebuild From Scratch" });
  await rebuild.click();
  const confirm = page.getByRole("alertdialog", { name: "Rebuild from scratch?" });
  const confirmRebuild = confirm.getByRole("button", { name: "Rebuild From Scratch" });
  await expect(confirmRebuild).toBeEnabled();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await routeMutation(page, "schedulePublications:publish", async (route) => {
    await held;
    await route.fallback();
  });
  const publish = page.getByRole("region", { name: "Publish to MeetCal" });
  await publish.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(publish.getByRole("button", { name: "Publishing…" })).toBeDisabled();
  await expect(rebuild).toBeDisabled();
  await expect(confirmRebuild).toBeDisabled();
  await expect(changes).toHaveAttribute("inert", "");
  release();
  await expect(publish.getByRole("heading", { name: "Sent for Review" })).toBeVisible();
  await expect(changes).not.toHaveAttribute("inert", "");
  await expect(rebuild).toBeEnabled();
  expect(calls.publishes.at(-1)?.args).toMatchObject({ base: "published", edits: [] });
  expect(calls.previews.every((call) => call.args.base === "published")).toBe(true);
});

test("signed in, drafts save and list, and a publish is sent for review", async ({ page }) => {
  const calls = await mockBuilder(page, { signedIn: true });
  await page.goto("/schedule-builder");
  const drafts = page.getByRole("region", { name: "Saved Schedules" });
  await expect(drafts.getByRole("link", { name: MEET })).toHaveAttribute("href", "/schedule-builder?meet=Turkey%20Cup");

  await loadAndBuild(page);
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
  expect(calls.saves).toEqual([{ args: { meet: MEET, options: defaultOptions, edits: [], base: "entries", baseVersion: null }, authorization: "Bearer token_user_ci" }]);

  const publish = page.getByRole("region", { name: "Publish to MeetCal" });
  await expect(publish.getByLabel("Contact Email")).toHaveValue("user_ci@example.com");
  await expect(publish).toContainText("A meet’s first publish is reviewed before it goes live");
  await publish.getByRole("button", { name: "Publish" }).click();
  await expect(publish.getByRole("heading", { name: "Sent for Review" })).toBeVisible();
  await expect(publish.getByRole("status")).toContainText("2 sessions and 3 athletes");
  expect(calls.publishes).toEqual([
    { args: { meet: MEET, options: defaultOptions, edits: [], base: "entries", baseVersion: null, contactEmail: "user_ci@example.com" }, authorization: "Bearer token_user_ci" },
  ]);
  await expect(publish.getByText("In Review")).toBeVisible();
  expect(calls.publications.every((call) => call.authorization === "Bearer token_user_ci")).toBe(true);
  await expect(publish.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Ava Smith: Move To…" }).click();
  await page.getByRole("group", { name: "Move To…" }).getByRole("button", { name: "Session 2 · Red" }).click();
  await expect(sessionCard(page, 2)).toContainText("Ava Smith");
  await expect(publish.getByRole("heading", { name: "Sent for Review" })).toHaveCount(0);
  await publish.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(publish.getByRole("heading", { name: "Sent for Review" })).toBeVisible();
  expect(calls.publishes.map((call) => call.args.edits)).toEqual([[], [{ kind: "moveAthlete", athlete: "2|ava smith", fromSession: 1, fromPlatform: "Red", occurrence: 0, toSession: 2, toPlatform: "Red" }]]);
  await expect(publish.getByText("In Review")).toHaveCount(2);

  await page.getByRole("link", { name: "Load Another Meet" }).click();
  await drafts.getByRole("button", { name: `Delete the saved schedule for ${MEET}` }).click();
  await expect(drafts).toContainText("No saved schedules yet.");
  expect(calls.deletes.map((call) => call.args)).toEqual([{ meet: MEET }]);
});

test("a published meet opens on its schedule, folds in Sport80's changes, and asks before rebuilding from scratch", async ({ page }) => {
  const calls = await mockBuilder(page, { signedIn: true, published: true });
  await page.goto("/schedule-builder?meet=Turkey%20Cup");
  const changes = page.getByRole("region", { name: "Sport80 Changes" });
  await expect(changes).toContainText("1 new lifter isn’t placed, so they stay off the start list when you publish.");
  await expect(changes).toContainText("1 lifter is marked on the board.");
  await expect(changes).toContainText("Last Checked");
  expect(calls.previews.at(-1)?.args).toEqual({ meet: MEET, options: defaultOptions, edits: [], base: "published" });
  await expect(sessionCard(page, 1).locator("li", { hasText: "Ava Smith" })).toContainText("No Longer on Sport80");

  await changes.getByRole("button", { name: "Ella Late: Add to Session 1 · Red" }).click();
  await expect(sessionCard(page, 1)).toContainText("Ella Late");
  await expect(changes).toContainText("Every new lifter is placed.");
  await page.getByRole("button", { name: "Ava Smith: Remove" }).click();
  await expect(sessionCard(page, 1)).not.toContainText("Ava Smith");
  await expect(changes).toContainText("1 lifter comes off the start list when you publish.");
  expect(calls.previews.at(-1)?.args.edits).toEqual([
    { kind: "addAthlete", athlete: "9|ella late", toSession: 1, toPlatform: "Red" },
    { kind: "removeAthlete", athlete: "2|ava smith", fromSession: 1, fromPlatform: "Red", occurrence: 0 },
  ]);

  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await changes.getByRole("button", { name: "Ella Late: Add To…" }).click();
  await page.getByRole("group", { name: "Add To…" }).getByRole("button", { name: "Session 2 · Red" }).click();
  await expect(sessionCard(page, 2)).toContainText("Ella Late");
  expect(calls.previews.at(-1)?.args.edits).toEqual([{ kind: "addAthlete", athlete: "9|ella late", toSession: 2, toPlatform: "Red" }]);

  await changes.getByRole("button", { name: "Check Sport80 Now" }).click();
  await expect.poll(() => calls.loads.map((call) => call.args)).toEqual([{ url: MEET_PAGE_URL }]);
  await expect(changes.getByRole("button", { name: "Check Sport80 Now" })).toBeEnabled();
  const previewsAfterCheck = calls.previews.length;
  const lastChecked = await changes.getByText(/^Last Checked/).innerText();
  await routeAction(page, "scheduleBuilderLoad:load", (route) => {
    calls.sport80.checkedAt = Date.UTC(2026, 10, 12, 17, 30);
    return route.fulfill(valueAnswer({ meet: MEET, refreshed: false, checkedAt: calls.sport80.checkedAt, nextCheckAt: calls.sport80.checkedAt + 10 * 60 * 1000 }));
  });
  await changes.getByRole("button", { name: "Check Sport80 Now" }).click();
  await expect(changes.getByRole("status")).toContainText("a few minutes ago. Check again after");
  await expect(changes.getByText(/^Last Checked/)).not.toHaveText(lastChecked);
  expect(calls.previews.length).toBeGreaterThan(previewsAfterCheck);

  const publish = page.getByRole("region", { name: "Publish to MeetCal" });
  await publish.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(publish.getByRole("heading", { name: "Sent for Review" })).toBeVisible();
  expect(calls.publishes.at(-1)?.args).toMatchObject({ base: "published", baseVersion: "pub_1", edits: [{ kind: "addAthlete", athlete: "9|ella late", toSession: 2, toPlatform: "Red" }] });

  await page.getByRole("button", { name: "Rebuild From Scratch" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Rebuild from scratch?" });
  await expect(confirm).toContainText(
    "Rebuilding from scratch regroups the start list, with Sport80’s new lifters added and the lifters it no longer lists taken off, and replaces the published sessions when you publish. It also discards your edit.",
  );
  await confirm.getByRole("button", { name: "Keep Editing" }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole("button", { name: "Rebuild From Scratch" }).click();
  await page.getByRole("alertdialog", { name: "Rebuild from scratch?" }).getByRole("button", { name: "Rebuild From Scratch" }).click();
  await expect.poll(() => calls.previews.at(-1)?.args).toEqual({ meet: MEET, options: defaultOptions, edits: [], base: "entries" });
  await expect(changes).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Build Again" })).toBeVisible();
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
