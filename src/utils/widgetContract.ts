/**
 * The data contract between the JS app and the native home-screen widgets
 * (iOS `targets/SavedWidget/`, Android `widget/`) and the iOS App Intents
 * (`plugins/ios-app-intents/`), which read the same App Group payloads.
 *
 * The native sides cannot import this file, so `widgetContract.test.ts` reads
 * their sources and fails when a field or key here has no native reader (or a
 * native reader expects one this side no longer writes). Change both together.
 */

/** iOS App Group shared by the app, the widget extension and the intents. */
export const WIDGET_APP_GROUP_ID = "group.com.memohnsen.meetcal";

/**
 * Native storage keys (iOS App Group `UserDefaults`, Android
 * `SharedPreferences`) the native module writes the payloads under.
 */
export const WIDGET_STORAGE_KEYS = {
  selectedMeet: "selectedMeet",
  savedSessions: "savedSessions",
  qualifyingTotals: "qualifyingTotalsWidgetData",
  standards: "standardsWidgetData",
  intlRankings: "intlRankingsWidgetData",
} as const;

/**
 * One saved-session row as serialized to the widget. Snake case is the wire
 * format both native decoders read.
 *
 * - `start_time`: the meet-local wall-clock time the app shows ("9:00 AM").
 *   Display only; the native side never parses it.
 * - `start_at_ms`: the session's start instant (epoch ms), computed with the
 *   meet's IANA zone from its config. Omitted when the app has no usable zone
 *   (the config lookup failed, or the identifier does not resolve): the native
 *   side then keeps the row instead of guessing, the same policy as
 *   `lib/saved-sessions-prune.ts`.
 * - `day_label`: short meet-local day ("Sat, Jun 20") for multi-day meets.
 */
export const SAVED_WIDGET_ROW_FIELDS = [
  "id",
  "meet",
  "platform",
  "session_number",
  "start_time",
  "start_at_ms",
  "weigh_in_time",
  "weight_class",
  "date",
  "day_label",
  "time_zone",
  "url",
] as const;

export type SavedWidgetRowField = (typeof SAVED_WIDGET_ROW_FIELDS)[number];

export type SavedWidgetRow = {
  id: string;
  meet: string;
  platform: string;
  session_number: number;
  start_time: string;
  start_at_ms?: number;
  weigh_in_time: string;
  weight_class: string;
  date: string;
  day_label?: string;
  time_zone?: string;
  url: string;
};

/** Top-level keys of the `updateDataWidgets` JSON, one per data widget. */
export const DATA_WIDGET_PAYLOAD_KEYS = [
  "qualifyingTotals",
  "standards",
  "intlRankings",
] as const;

export type DataWidgetPayloadKey = (typeof DATA_WIDGET_PAYLOAD_KEYS)[number];

/** Fields of one data-widget payload (`MeetCalSharedDataPayload`). */
export const DATA_WIDGET_PAYLOAD_FIELDS = [
  "title",
  "subtitle",
  "emptyMessage",
  "linkURL",
  "maxRows",
  "rows",
] as const;

/** Fields of one data-widget row (`MeetCalSharedDataRow`). */
export const DATA_WIDGET_ROW_FIELDS = [
  "leading",
  "title",
  "trailing",
  "subtitle",
] as const;
