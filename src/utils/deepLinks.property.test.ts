import * as fc from "fast-check";
import { shouldLinkExternally } from "expo-router/build/utils/url";

import {
  createAppDeepLink,
  getNotificationDeepLink,
  getOneSignalDeepLink,
  isInternalRoutePath,
  normalizeDeepLinkHref,
} from "@/utils/deepLinks";
import { HOSTILE_STRINGS, hostileStringArb, hostileValueArb } from "@/test-support/arbitraries";

/**
 * Deep links come from push payloads and other apps, so whatever arrives must
 * either be refused or become a route inside the app: one leading `/`, and
 * nothing Expo Router would hand to the OS as an external URL
 * (`shouldLinkExternally`, the check `router.push` makes).
 */

function expectInternalRoute(href: unknown) {
  expect(typeof href).toBe("string");
  const route = href as string;
  expect(route.startsWith("/")).toBe(true);
  expect(route.startsWith("//")).toBe(false);
  expect(shouldLinkExternally(route)).toBe(false);
}

const SCHEMES = ["meetcal", "MEETCAL", "MeetCal", "https", "http", "javascript", "data", "file", "intent", "exp", "mailto", "tel", ""];
const SEPARATORS = ["://", ":///", ":////", ":", ":/", ":\\\\", ":/\\", "://\\", "//", "/\\", "\\\\"];
const HOSTS = ["", "meetcal", "evil.example", "open", "%2F%2Fevil.example", "..", "user@evil.example", "evil.example:80", "[::1]", "meetcal.app"];
const SEGMENTS = ["", ".", "..", "%2F", "%2f%2f", "\\", "evil.example", "%5C", "open", "saved", "%00", " ", "\t", " ", "／", "javascript:alert(1)", "comp-data", "(tabs)"];

const segmentArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...SEGMENTS) },
  { weight: 2, arbitrary: fc.stringMatching(/^[a-z0-9-]{1,8}$/) },
  { weight: 1, arbitrary: hostileStringArb },
);

/** URL-shaped strings: random schemes, separators, hosts, encoded and backslashed paths. */
const deepLinkArb: fc.Arbitrary<string> = fc
  .record({
    lead: fc.constantFrom("", " ", "\t", "\n "),
    scheme: fc.oneof(fc.constantFrom(...SCHEMES), fc.stringMatching(/^[a-z][a-z0-9+.-]{0,8}$/)),
    separator: fc.constantFrom(...SEPARATORS),
    host: fc.oneof(fc.constantFrom(...HOSTS), fc.domain()),
    segments: fc.array(segmentArb, { maxLength: 4 }),
    joiner: fc.constantFrom("/", "\\", "//"),
    query: fc.constantFrom("", "?x=1", "?next=//evil.example", "#frag", "?%2F%2F"),
    trail: fc.constantFrom("", " ", "\n"),
  })
  .map(
    ({ lead, scheme, separator, host, segments, joiner, query, trail }) =>
      `${lead}${scheme}${separator}${host}${segments.length ? joiner : ""}${segments.join(joiner)}${query}${trail}`,
  );

/** Strings that begin like a path: `/x`, `//host`, `/\host`, `/%2F/host`. */
const pathLikeArb: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom("/", "//", "///", "/\\", "\\", "/%2F", " /", "/\t/", "/ /"), fc.array(segmentArb, { maxLength: 3 }))
  .map(([lead, segments]) => `${lead}${segments.join("/")}`);

const anyLinkArb = fc.oneof(deepLinkArb, pathLikeArb, hostileStringArb, fc.webUrl(), fc.string({ unit: "binary" }));

describe("deep links (properties)", () => {
  it("normalizes any string to null or an internal route", () => {
    fc.assert(
      fc.property(anyLinkArb, (value) => {
        const href = normalizeDeepLinkHref(value);
        if (href !== null) expectInternalRoute(href);
      }),
    );
  });

  it("accepts as a return path only internal routes", () => {
    fc.assert(
      fc.property(fc.oneof(anyLinkArb, hostileValueArb), (value) => {
        if (isInternalRoutePath(value)) expectInternalRoute(value);
      }),
    );
  });

  it("reads a notification's link verbatim from one of its fields, or null, and never throws", () => {
    const fieldArb = fc.oneof(anyLinkArb, hostileValueArb);
    const dataArb = fc.oneof(
      fc.record({ url: fieldArb, deepLink: fieldArb, deeplink: fieldArb, link: fieldArb, route: fieldArb }, { requiredKeys: [] }),
      hostileValueArb,
      fc.anything(),
    );
    fc.assert(
      fc.property(dataArb, (data) => {
        const link = getNotificationDeepLink(data as Record<string, unknown>);
        if (link === null) return;
        expect(typeof link === "string" && link.trim().length > 0).toBe(true);
        const fields = data as Record<string, unknown>;
        expect([fields.url, fields.deepLink, fields.deeplink, fields.link, fields.route]).toContain(link);
      }),
    );
  });

  it("reads a OneSignal click's link from any event, or null, and never throws", () => {
    const fieldArb = fc.oneof(anyLinkArb, hostileValueArb);
    const eventArb = fc.oneof(
      fc.record(
        {
          result: fc.oneof(fc.record({ url: fieldArb }, { requiredKeys: [] }), hostileValueArb),
          notification: fc.oneof(
            fc.record(
              {
                launchURL: fieldArb,
                additionalData: fc.oneof(fc.record({ url: fieldArb, route: fieldArb }, { requiredKeys: [] }), hostileValueArb),
              },
              { requiredKeys: [] },
            ),
            hostileValueArb,
          ),
        },
        { requiredKeys: [] },
      ),
      hostileValueArb,
      fc.anything(),
    );
    fc.assert(
      fc.property(eventArb, (event) => {
        const link = getOneSignalDeepLink(event);
        if (link === null) return;
        expect(typeof link === "string" && link.trim().length > 0).toBe(true);
        // What `_layout.tsx` does with it: push it only as an internal route.
        const href = normalizeDeepLinkHref(link);
        if (href !== null) expectInternalRoute(href);
      }),
    );
  });

  it("normalizes a link it created back to the route and its query", () => {
    const routeArb = fc
      .array(fc.oneof(fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,11}$/), fc.constantFrom("(tabs)", "comp-data", "shared-screens")), {
        maxLength: 4,
      })
      .map((segments) => `/${segments.join("/")}`);
    const paramsArb = fc.dictionary(
      fc.stringMatching(/^[a-zA-Z_]{1,10}$/),
      fc.oneof(
        fc.string({ unit: "grapheme" }),
        fc.constantFrom(...HOSTILE_STRINGS.filter((value) => !/[\uD800-\uDFFF]/.test(value))),
        fc.integer(),
        fc.constantFrom(undefined, null, ""),
      ),
      { maxKeys: 4 },
    );
    fc.assert(
      fc.property(routeArb, fc.option(paramsArb, { nil: undefined }), fc.boolean(), (route, params, dropSlash) => {
        const link = createAppDeepLink(dropSlash ? route.slice(1) : route, params);
        const href = normalizeDeepLinkHref(link);
        expectInternalRoute(href);
        const [path, query = ""] = (href as string).split("?");
        expect(path).toBe(route);
        const expected = Object.entries(params ?? {})
          .filter(([, value]) => value !== undefined && value !== null && value !== "")
          .map(([key, value]) => [key, String(value)]);
        expect([...new URLSearchParams(query).entries()]).toEqual(expected);
      }),
    );
  });
});

describe("deep link counterexamples", () => {
  it("reads no link from a OneSignal event that is not an object", () => {
    // Shrunk counterexample: `getOneSignalDeepLink(null)` threw a TypeError.
    expect(getOneSignalDeepLink(null)).toBeNull();
    expect(getOneSignalDeepLink(undefined)).toBeNull();
  });
});
