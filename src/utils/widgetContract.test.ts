/**
 * Pins the JS <-> native widget contract. The Swift (widget extension, App
 * Intents) and Kotlin (Android widgets) sources cannot import
 * `widgetContract.ts`, so this reads them as text and fails when a field or
 * key exists on one side only. That is how the time-zone bug shipped: JS
 * added `time_zone` and no native side read it.
 */
import fs from "fs";
import path from "path";

import type { SavedSession } from "@/hooks/useSavedSessions";
import { buildDataWidgetPayloads, defaultWidgetSettings } from "@/utils/dataWidgets";
import { buildSavedWidgetRows } from "@/utils/savedWidget";
import {
  DATA_WIDGET_PAYLOAD_FIELDS,
  DATA_WIDGET_PAYLOAD_KEYS,
  DATA_WIDGET_ROW_FIELDS,
  SAVED_WIDGET_ROW_FIELDS,
  WIDGET_APP_GROUP_ID,
  WIDGET_STORAGE_KEYS,
} from "@/utils/widgetContract";

const ROOT = path.join(__dirname, "..", "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const SWIFT_SHARED = read("targets/SavedWidget/MeetCalSharedModels.swift");
const SWIFT_WIDGET = read("targets/SavedWidget/SavedWidget.swift");
const SWIFT_SHARED_STORE = read("plugins/ios-app-intents/SharedStore.swift");
const OBJC_MODULE = read("plugins/ios-saved-widget/SavedWidgetModule.m");
const KOTLIN_SAVED = read("widget/java/SavedWidgetProvider.kt");
const KOTLIN_DATA = read("widget/java/DataWidgetProvider.kt");
const KOTLIN_MODULE = read("widget/java/SavedWidgetModule.kt");

/** The body of `struct <name> ... { ... }` (no nested braces in these models). */
function swiftStructBody(source: string, name: string): string {
  const match = new RegExp(`struct ${name}\\b[^{]*\\{([^}]*)\\}`).exec(source);
  if (!match) throw new Error(`struct ${name} not found`);
  return match[1];
}

/** Stored `let` property names declared in a Swift struct body. */
function swiftLetNames(body: string): string[] {
  return Array.from(body.matchAll(/^\s*let\s+(\w+)\s*:/gm), (m) => m[1]);
}

/** JSON keys a Kotlin source reads with `opt*("key"`. */
function kotlinReadKeys(source: string): string[] {
  return Array.from(
    source.matchAll(/\.opt(?:String|Int|Long|Double|Boolean|JSONArray|JSONObject)\(\s*"(\w+)"/g),
    (m) => m[1],
  );
}

function sorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort();
}

const fullSession: SavedSession = {
  id: "s1",
  meet: "Test Meet" as SavedSession["meet"],
  sessionNumber: 3,
  platform: "Red",
  weightClass: "89kg",
  startTime: "9:00 AM",
  weighInTime: "7:00 AM",
  date: "2026-06-20",
};

describe("saved-session row contract", () => {
  it("JS writes exactly the documented fields when every field resolves", () => {
    const [row] = buildSavedWidgetRows([fullSession], "America/Denver");
    expect(sorted(Object.keys(row))).toEqual(sorted(SAVED_WIDGET_ROW_FIELDS));
  });

  it("the Swift row model decodes every field JS writes, and nothing else", () => {
    const body = swiftStructBody(SWIFT_SHARED, "MeetCalSharedSavedSessionRow");
    expect(sorted(swiftLetNames(body))).toEqual(sorted(SAVED_WIDGET_ROW_FIELDS));
  });

  it("the Swift fields JS may omit are optional, so decoding never fails on them", () => {
    const body = swiftStructBody(SWIFT_SHARED, "MeetCalSharedSavedSessionRow");
    for (const field of ["start_at_ms", "day_label", "time_zone"]) {
      expect(body).toMatch(new RegExp(`let ${field}: \\w+\\?`));
    }
  });

  it("Kotlin reads only documented fields, including the start instant", () => {
    const keys = kotlinReadKeys(KOTLIN_SAVED);
    for (const key of keys) {
      expect(SAVED_WIDGET_ROW_FIELDS).toContain(key);
    }
    expect(keys).toEqual(expect.arrayContaining(["start_at_ms", "start_time", "day_label"]));
  });

  it("no native side parses the display time as a 24-hour clock", () => {
    // `start_time` is "9:00 AM"; parsing it as HH:mm:ss failed silently and
    // kept every session on the widget forever.
    for (const source of [SWIFT_SHARED, SWIFT_WIDGET, KOTLIN_SAVED]) {
      expect(source).not.toContain("HH:mm:ss");
    }
  });
});

describe("data widget payload contract", () => {
  const payloads = buildDataWidgetPayloads(
    {
      totalsData: { Nationals: { Senior: { Men: { "89": 300 } } } },
      standardsData: {
        u15: { men: [], women: [] },
        youth: { men: [], women: [] },
        junior: { men: [], women: [] },
        senior: { men: [{ weightClass: "89", a: 330, b: 310 }], women: [] },
      },
      intlRankings: [
        {
          meet: "Worlds",
          ranking: 1,
          name: "A Lifter",
          weightClass: "89",
          total: 350,
          percentA: 101,
          gender: "Men",
          ageCategory: "Senior",
        },
      ],
    } as unknown as Parameters<typeof buildDataWidgetPayloads>[0],
    { ...defaultWidgetSettings, intlRankings: { meet: "Worlds", ageCategory: "Senior", gender: "Men" } },
  );

  it("JS writes one payload per documented key, with the documented fields", () => {
    expect(sorted(Object.keys(payloads))).toEqual(sorted(DATA_WIDGET_PAYLOAD_KEYS));
    for (const key of DATA_WIDGET_PAYLOAD_KEYS) {
      expect(sorted(Object.keys(payloads[key]))).toEqual(sorted(DATA_WIDGET_PAYLOAD_FIELDS));
      for (const row of payloads[key].rows) {
        for (const field of Object.keys(row)) {
          expect(DATA_WIDGET_ROW_FIELDS).toContain(field);
        }
      }
    }
  });

  it("the Swift payload and row models match the documented fields", () => {
    expect(sorted(swiftLetNames(swiftStructBody(SWIFT_SHARED, "MeetCalSharedDataPayload")))).toEqual(
      sorted(DATA_WIDGET_PAYLOAD_FIELDS),
    );
    expect(sorted(swiftLetNames(swiftStructBody(SWIFT_SHARED, "MeetCalSharedDataRow")))).toEqual(
      sorted(DATA_WIDGET_ROW_FIELDS),
    );
  });

  it("Kotlin reads only documented payload and row fields", () => {
    const documented = [...DATA_WIDGET_PAYLOAD_FIELDS, ...DATA_WIDGET_ROW_FIELDS] as string[];
    for (const key of kotlinReadKeys(KOTLIN_DATA)) {
      expect(documented).toContain(key);
    }
  });

  it("both native writers map every payload key", () => {
    for (const key of DATA_WIDGET_PAYLOAD_KEYS) {
      expect(OBJC_MODULE).toContain(`@"${key}"`);
      expect(KOTLIN_MODULE).toContain(`"${key}"`);
    }
  });
});

describe("storage keys and App Group", () => {
  it("the Swift shared keys match the JS keys", () => {
    for (const value of Object.values(WIDGET_STORAGE_KEYS)) {
      expect(SWIFT_SHARED).toContain(`= "${value}"`);
    }
  });

  it("the Obj-C writer and the Kotlin providers use the same keys", () => {
    for (const value of Object.values(WIDGET_STORAGE_KEYS)) {
      expect(OBJC_MODULE).toContain(`@"${value}"`);
      expect(KOTLIN_SAVED + KOTLIN_DATA).toContain(`"${value}"`);
    }
  });

  it("every iOS reader and writer uses one App Group id", () => {
    expect(SWIFT_SHARED).toContain(`appGroupIdentifier = "${WIDGET_APP_GROUP_ID}"`);
    expect(OBJC_MODULE).toContain(`@"${WIDGET_APP_GROUP_ID}"`);
    expect(read("targets/SavedWidget/expo-target.config.js")).toContain(`'${WIDGET_APP_GROUP_ID}'`);
    expect(read("app.config.js")).toContain(`'${WIDGET_APP_GROUP_ID}'`);
    // The widget and the intents read through the shared constant, not their own literal.
    expect(SWIFT_WIDGET).not.toContain("group.com.");
    expect(SWIFT_SHARED_STORE).not.toContain("group.com.");
  });

  it("the native saved-session clear leaves the data widgets alone", () => {
    const objcClear = /RCT_EXPORT_METHOD\(clearSavedWidget\)\s*\{([\s\S]*?)\n\}/.exec(OBJC_MODULE)?.[1];
    expect(objcClear).toBeDefined();
    expect(objcClear).not.toMatch(/QualifyingTotals|Standards|IntlRankings/);

    const kotlinClear = /fun clearSavedWidget\(\)\s*\{([\s\S]*?)\n {2}\}/.exec(KOTLIN_MODULE)?.[1];
    expect(kotlinClear).toBeDefined();
    expect(kotlinClear).not.toMatch(/KEY_QUALIFYING|KEY_STANDARDS|KEY_INTL|DataWidgetProvider/);
  });
});
