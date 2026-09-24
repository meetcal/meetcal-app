import type { Href } from "expo-router";
import { Linking } from "react-native";

const APP_SCHEME = "meetcal";

export const DEEP_LINKS = {
  saved: "/open/saved",
  widgetSettings: "/schedule-toolbar/widget-settings",
  qualifyingTotals: "/comp-data/new-qualifying-totals",
  standards: "/comp-data/new-standards",
  intlRankings: "/comp-data/rankings",
  records: "/comp-data/records",
} as const;

type SessionDetailsParams = {
  id?: string;
  meet?: string;
  sessionNumber?: string | number;
  platform?: string;
  weightClass?: string;
  startTime?: string;
  weighInTime?: string;
  date?: string;
  athleteName?: string;
};

type NotificationData = Record<string, unknown> | null | undefined;

export function createAppDeepLink(path: string, params?: Record<string, unknown>) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const query = new URLSearchParams();

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  const queryString = query.toString();
  return `${APP_SCHEME}://${normalizedPath}${queryString ? `?${queryString}` : ""}`;
}

export function createSessionDetailsDeepLink(params: SessionDetailsParams) {
  return createAppDeepLink("/shared-screens/schedule-details", params);
}

export function createQualifyingTotalsDeepLink(params: {
  event: string;
  gender: string;
  ageGroup: string;
}) {
  return createAppDeepLink(DEEP_LINKS.qualifyingTotals, params);
}

export function createStandardsDeepLink(params: {
  gender: string;
  ageGroup: string;
}) {
  return createAppDeepLink(DEEP_LINKS.standards, params);
}

export function createIntlRankingsDeepLink(params: {
  meet: string;
  ageCategory: string;
  gender: string;
}) {
  return createAppDeepLink(DEEP_LINKS.intlRankings, {
    meet: params.meet,
    age_category: params.ageCategory,
    gender: params.gender,
  });
}

export function createRecordsDeepLink() {
  return createAppDeepLink(DEEP_LINKS.records);
}

export function getNotificationDeepLink(data: NotificationData) {
  if (!data) return null;

  const value =
    data.url ??
    data.deepLink ??
    data.deeplink ??
    data.link ??
    data.route;

  return typeof value === "string" && value.trim() ? value : null;
}

export function getOneSignalDeepLink(event: unknown) {
  const payload = event as {
    result?: { url?: unknown };
    notification?: {
      launchURL?: unknown;
      additionalData?: NotificationData;
    };
  };

  const values = [
    payload.result?.url,
    getNotificationDeepLink(payload.notification?.additionalData),
    payload.notification?.launchURL,
  ];

  const value = values.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );

  return value ?? null;
}

/**
 * Whether a `from` param is safe to hand to `router.replace`.
 *
 * `from` is a return path threaded through sign-in and the paywall. Callers
 * have not always sent one: the schedule tab's profile button sent the bare
 * string `"info"`, and sign-in's guard tested it against the unrelated literal
 * `"feature"`, so `router.replace("info")` resolved relative to
 * `/(auth)/sign-in` and dropped the user on a route that does not exist
 * instead of where they were going. Require an absolute in-app path, and
 * reject anything that could navigate off-app.
 *
 * Deep links (`normalizeDeepLinkHref`) use the same rule: a push payload of
 * `//host/path` used to be accepted as an in-app href because it starts with
 * `/`.
 */
export function isInternalRoutePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // `//host` is protocol-relative, not an in-app path.
  return value.startsWith('/') && !value.startsWith('//');
}

export function normalizeDeepLinkHref(value: string): Href | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/")) {
    return isInternalRoutePath(trimmed) ? (trimmed as Href) : null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== `${APP_SCHEME}:`) {
      return null;
    }

    const hostPath =
      parsed.hostname && parsed.hostname !== APP_SCHEME
        ? `/${parsed.hostname}`
        : "";
    const path = `${hostPath}${parsed.pathname || ""}` || "/";
    return isInternalRoutePath(path) ? (`${path}${parsed.search}` as Href) : null;
  } catch {
    return null;
  }
}

export async function openExternalLink(value: string) {
  const supported = await Linking.canOpenURL(value);
  if (supported) {
    await Linking.openURL(value);
  }
}
