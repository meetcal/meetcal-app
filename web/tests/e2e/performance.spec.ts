import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type CDPSession, type Page, type TestInfo } from "@playwright/test";
import { mockAuth, routeNarrowedTable, routeQuery, textAnswer } from "./support/api";

const SLOW_4G = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};
const PHONE_CPU_SLOWDOWN = 4;

const vercel: { rewrites: Array<{ source: string; destination: string }> } = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
);

type RouteBudget = { lcpMs: number; cls: number; ownBytes: number };
type RouteName = "home" | "records" | "qualifyingTotals" | "meetCenter" | "meetCenterOnAMeet" | "wrapped" | "scheduleBuilder" | "signIn";

const budgets: {
  requestsBeforeWasm: number;
  slow4gPhone: { ownRequests: number; filterBlockingMs: number; routes: Record<RouteName, RouteBudget> };
} = JSON.parse(readFileSync(join(process.cwd(), "tests/budgets.json"), "utf8"));

const BUDGETS = budgets.slow4gPhone.routes;
const FILTER_ROUNDS = 3;
const SETTLE_TIMEOUT_MS = 15_000;

const WOMEN_CLASSES = ["40kg", "44kg", "48kg", "53kg", "58kg", "63kg", "69kg", "77kg", "86kg", "86+kg"];
const MEN_CLASSES = ["50kg", "55kg", "60kg", "65kg", "71kg", "79kg", "88kg", "94kg", "110kg", "110+kg"];
const AGES = ["Senior", "Junior", "Youth", "U15", "U13", "Masters 35", "Masters 40", "Masters 45", "Masters 50", "Masters 55"];
const RECORD_TYPES = ["USAW", "USAMW", "IWF", "Pan American", "American Masters", "Collegiate"];
const EVENTS = ["Nationals", "American Open Finals", "American Open Series 1", "American Open Series 2", "American Open Series 3", "Junior Nationals", "Youth Nationals", "Masters Nationals"];

function everyCategory<T>(kinds: string[], ages: string[], row: (kind: string, gender: string, age: string, weightClass: string, step: number) => T): T[] {
  const rows: T[] = [];
  for (const kind of kinds) {
    for (const [gender, classes] of [["Women", WOMEN_CLASSES], ["Men", MEN_CLASSES]] as const) {
      for (const age of ages) {
        classes.forEach((weightClass, step) => rows.push(row(kind, gender, age, weightClass, step)));
      }
    }
  }
  return rows;
}

const holder = { name: "Test Lifter", date: "2025-06-01", location: "Columbus, OH" };

const recordRows = everyCategory(RECORD_TYPES, AGES, (record_type, gender, age_category, weight_class, step) => {
  const total_record = (gender === "Men" ? 250 : 170) + step * 12;
  return {
    record_type, gender, age_category, weight_class,
    snatch_record: Math.round(total_record * 0.45), cj_record: total_record - Math.round(total_record * 0.45), total_record,
    snatch_by: holder, cj_by: holder, total_by: holder,
  };
});

const qualifyingTotalRows = everyCategory(EVENTS, AGES.slice(0, 8), (event_name, gender, age_category, weight_class, step) => ({
  event_name, gender, age_category, weight_class, qualifying_total: (gender === "Men" ? 200 : 140) + step * 9,
}));

const meet = {
  federation: "USAW", name: "Test Meet", start_date: "2026-06-20", end_date: "2026-06-21", time_zone: "America/Los_Angeles",
  venue_city: "Oakland", venue_name: "Test Arena", venue_state: "CA", venue_street: "100 Main St", venue_zip: "94612",
  status: "scheduled", venue_map_pdf_url: null, venue_map_apple_url: null,
};

const scheduleRows = Array.from({ length: 48 }, (_, index) => ({
  date: index < 24 ? "2026-06-20" : "2026-06-21", meet: "Test Meet", platform: index % 2 === 0 ? "Red" : "Blue",
  session_id: index + 1, start_time: `${String(8 + (index % 12)).padStart(2, "0")}:00`, weigh_in_time: "07:00",
  weight_class: WOMEN_CLASSES[index % WOMEN_CLASSES.length],
}));

async function routeMeets(page: Page) {
  await mockAuth(page);
  await routeQuery(page, "meets:list", (route) => route.fulfill(textAnswer([meet])));
  await routeQuery(page, "meets:completed", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "meets:schedule", (route) => route.fulfill(textAnswer(scheduleRows)));
  await routeQuery(page, "meets:athletes", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "meets:athletesSessions", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "results:byMeet", (route) => route.fulfill(textAnswer([])));
}

type Measured = {
  lcpMs: number;
  appMountedMs: number;
  cls: number;
  ownBytes: number;
  ownRequests: number;
  requestsBeforeWasm: number;
};

type Sent = { url: string; sentAt: number; bytes: number };

function observeVitals() {
  const vitals = { lcp: 0, cls: 0, appMounted: 0, longTasks: [] as Array<[number, number]> };
  Object.assign(window, { __vitals: vitals });
  new MutationObserver((_, observer) => {
    if (document.readyState === "loading" || document.getElementById("app-loading")) return;
    vitals.appMounted = performance.now();
    observer.disconnect();
  }).observe(document, { childList: true, subtree: true });
  const observe = (type: string, onEntry: (entry: PerformanceEntry) => void) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({ type, buffered: true });
    } catch {
      return;
    }
  };
  observe("largest-contentful-paint", (entry) => {
    vitals.lcp = entry.startTime;
  });
  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (!shift.hadRecentInput) vitals.cls += shift.value;
  });
  observe("longtask", (entry) => {
    vitals.longTasks.push([entry.startTime, entry.duration]);
  });
}

type Vitals = { lcp: number; cls: number; appMounted: number; longTasks: Array<[number, number]> };
const vitalsOf = (page: Page) => page.evaluate(() => (window as unknown as { __vitals: Vitals }).__vitals);

async function throttle(page: Page): Promise<{ cdp: CDPSession; sent: Map<string, Sent> }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", SLOW_4G);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: PHONE_CPU_SLOWDOWN });
  const sent = new Map<string, Sent>();
  cdp.on("Network.requestWillBeSent", (event) => {
    if (event.request.method === "OPTIONS") return;
    sent.set(event.requestId, { url: event.request.url, sentAt: event.timestamp, bytes: 0 });
  });
  cdp.on("Network.loadingFinished", (event) => {
    const request = sent.get(event.requestId);
    if (request) request.bytes = event.encodedDataLength;
  });
  return { cdp, sent };
}

async function measureLoad(page: Page, path: string, ready: () => Promise<void>, testInfo: TestInfo): Promise<Measured> {
  await page.addInitScript(observeVitals);
  const { sent } = await throttle(page);
  const target = new URL(path, testInfo.project.use.baseURL);
  const shell = vercel.rewrites.find(({ source }) => source === target.pathname)?.destination;
  if (shell !== undefined) {
    await page.route((url) => url.href === target.href, (route) =>
      route.fulfill({ path: join(process.cwd(), "dist", shell), contentType: "text/html; charset=utf-8" }),
    );
  }
  await page.goto(path);
  await expect(page.locator("#app-loading")).toHaveCount(0, { timeout: 30_000 });
  await ready();
  await page.waitForLoadState("networkidle");
  const vitals = await vitalsOf(page);
  const origin = new URL(testInfo.project.use.baseURL ?? page.url()).origin;
  const requests = [...sent.values()].sort((left, right) => left.sentAt - right.sentAt);
  const own = requests.filter(({ url }) => url.startsWith(origin));
  const wasmAt = requests.findIndex(({ url }) => /_bg\.wasm$/.test(url));
  expect(wasmAt, "the page never asked for the Wasm binary").toBeGreaterThanOrEqual(0);
  const measured = {
    lcpMs: Math.round(vitals.lcp),
    appMountedMs: Math.round(vitals.appMounted),
    cls: Number(vitals.cls.toFixed(4)),
    ownBytes: own.reduce((sum, { bytes }) => sum + bytes, 0),
    ownRequests: own.length,
    requestsBeforeWasm: wasmAt,
  };
  testInfo.annotations.push({ type: "measured", description: JSON.stringify({ path, ...measured }) });
  return measured;
}

function expectWithin(measured: Measured, budget: RouteBudget) {
  expect(measured.requestsBeforeWasm, "requests started before the Wasm binary").toBeLessThanOrEqual(budgets.requestsBeforeWasm);
  expect(measured.ownRequests, "requests to the site").toBeLessThanOrEqual(budgets.slow4gPhone.ownRequests);
  expect(measured.ownBytes, "bytes from the site").toBeLessThanOrEqual(budget.ownBytes);
  expect(measured.cls, "cumulative layout shift").toBeLessThanOrEqual(budget.cls);
  expect(measured.lcpMs, "the largest paint comes from the route's shell, before the app mounts").toBeLessThan(measured.appMountedMs);
  expect(measured.lcpMs, "largest contentful paint, ms").toBeLessThanOrEqual(budget.lcpMs);
}

type FilterStep = { label: string; pick: (page: Page) => Promise<unknown>; settled: (page: Page) => Promise<void> };

async function blockingTimesOf(page: Page, steps: FilterStep[], testInfo: TestInfo): Promise<number[]> {
  const times: number[] = [];
  for (const step of steps) {
    const startedAt = await page.evaluate(() => performance.now());
    await step.pick(page);
    await step.settled(page);
    await page.waitForTimeout(1_000);
    const { longTasks } = await vitalsOf(page);
    const blockingMs = Math.round(
      longTasks.filter(([start]) => start >= startedAt).reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0),
    );
    testInfo.annotations.push({ type: "measured", description: JSON.stringify({ step: step.label, blockingMs }) });
    times.push(blockingMs);
  }
  return times;
}

async function expectFiltersWithin(browser: Browser, testInfo: TestInfo, loaded: Page, open: (page: Page) => Promise<void>, steps: FilterStep[]) {
  const rounds = [await blockingTimesOf(loaded, steps, testInfo)];
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = testInfo.project.use;
  for (let round = 1; round < FILTER_ROUNDS; round += 1) {
    const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL });
    try {
      const page = await context.newPage();
      await page.addInitScript(observeVitals);
      await throttle(page);
      await open(page);
      rounds.push(await blockingTimesOf(page, steps, testInfo));
    } finally {
      await context.close();
    }
  }
  steps.forEach((step, index) => {
    const fewest = Math.min(...rounds.map((times) => times[index] ?? Number.POSITIVE_INFINITY));
    expect(fewest, `blocking time after ${step.label}, the fewest ms of ${FILTER_ROUNDS} fresh loads`).toBeLessThanOrEqual(budgets.slow4gPhone.filterBlockingMs);
  });
}

test.describe("throttled budgets on a Slow 4G phone", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium" || testInfo.project.name !== "mobile-chromium", "Chromium's DevTools protocol throttles one phone project");
    test.setTimeout(120_000);
  });

  test("Home", async ({ page }, testInfo) => {
    await mockAuth(page, { signedIn: false });
    const measured = await measureLoad(page, "/", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Your Competition Schedule, Simplified" })).toBeVisible();
    }, testInfo);
    expectWithin(measured, BUDGETS.home);
  });

  test("Records, and its organization filter", async ({ page, browser }, testInfo) => {
    const routeRecords = async (target: Page) => {
      await mockAuth(target);
      await routeNarrowedTable(target, "records", recordRows);
    };
    const showsEveryOrganization = (target: Page) => expect(target.locator("tbody")).toContainText("IWF", { timeout: SETTLE_TIMEOUT_MS });
    const organization = (target: Page) => target.getByRole("combobox", { name: "Organization", exact: true });
    await routeRecords(page);
    const measured = await measureLoad(page, "/records", () => showsEveryOrganization(page), testInfo);
    expectWithin(measured, BUDGETS.records);
    await expectFiltersWithin(browser, testInfo, page, async (fresh) => {
      await routeRecords(fresh);
      await fresh.goto("/records");
      await showsEveryOrganization(fresh);
    }, [
      {
        label: "Records: USAW",
        pick: (target) => organization(target).selectOption("USAW"),
        settled: (target) => expect(target.locator("tbody")).not.toContainText("IWF", { timeout: SETTLE_TIMEOUT_MS }),
      },
      { label: "Records: all organizations", pick: (target) => organization(target).selectOption({ index: 0 }), settled: showsEveryOrganization },
    ]);
  });

  test("Qualifying Totals, and its gender filter", async ({ page, browser }, testInfo) => {
    const routeTotals = async (target: Page) => {
      await mockAuth(target);
      await routeNarrowedTable(target, "qualifyingTotals", qualifyingTotalRows);
    };
    const showsWomen = (target: Page) => expect(target.locator("tbody")).toContainText("Women", { timeout: SETTLE_TIMEOUT_MS });
    const gender = (target: Page) => target.getByRole("combobox", { name: "Gender", exact: true });
    await routeTotals(page);
    const measured = await measureLoad(page, "/qualifying-totals", () => showsWomen(page), testInfo);
    expectWithin(measured, BUDGETS.qualifyingTotals);
    await expectFiltersWithin(browser, testInfo, page, async (fresh) => {
      await routeTotals(fresh);
      await fresh.goto("/qualifying-totals");
      await showsWomen(fresh);
    }, [
      {
        label: "Qualifying Totals: Men",
        pick: (target) => gender(target).selectOption("Men"),
        settled: (target) => expect(target.locator("tbody")).not.toContainText("Women", { timeout: SETTLE_TIMEOUT_MS }),
      },
      { label: "Qualifying Totals: all genders", pick: (target) => gender(target).selectOption({ index: 0 }), settled: showsWomen },
    ]);
  });

  test("Meet Center", async ({ page }, testInfo) => {
    await routeMeets(page);
    const measured = await measureLoad(page, "/meet-center", async () => {
      await expect(page.locator("#meet-search-input")).toBeVisible();
    }, testInfo);
    expectWithin(measured, BUDGETS.meetCenter);
  });

  test("Meet Center opened on a meet", async ({ page }, testInfo) => {
    await routeMeets(page);
    const measured = await measureLoad(page, "/meet-center?meet=Test%20Meet", async () => {
      await expect(page.locator("tbody")).toContainText("8:00 AM", { timeout: SETTLE_TIMEOUT_MS });
    }, testInfo);
    expectWithin(measured, BUDGETS.meetCenterOnAMeet);
  });

  test("Wrapped", async ({ page }, testInfo) => {
    await mockAuth(page, { signedIn: false });
    const measured = await measureLoad(page, "/wrapped", async () => {
      await expect(page.getByRole("button", { name: "Build wrapped" })).toBeVisible();
    }, testInfo);
    expectWithin(measured, BUDGETS.wrapped);
  });

  test("Schedule Builder, its own app", async ({ page }, testInfo) => {
    await mockAuth(page, { signedIn: false });
    const measured = await measureLoad(page, "/schedule-builder", async () => {
      await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
    }, testInfo);
    expectWithin(measured, BUDGETS.scheduleBuilder);
  });

  test("the sign-in a signed-out visitor gets on Records", async ({ page }, testInfo) => {
    await mockAuth(page, { signedIn: false });
    const measured = await measureLoad(page, "/records", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Sign in to continue" })).toBeVisible();
    }, testInfo);
    expectWithin(measured, BUDGETS.signIn);
  });
});
