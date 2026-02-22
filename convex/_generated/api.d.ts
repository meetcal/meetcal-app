/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as athletes from "../athletes.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as intlRankings from "../intlRankings.js";
import type * as liftingResults from "../liftingResults.js";
import type * as meetStatusJob from "../meetStatusJob.js";
import type * as meets from "../meets.js";
import type * as notificationPreferences from "../notificationPreferences.js";
import type * as pushNotifications from "../pushNotifications.js";
import type * as qualifyingTotals from "../qualifyingTotals.js";
import type * as records from "../records.js";
import type * as savedSessions from "../savedSessions.js";
import type * as schedule from "../schedule.js";
import type * as scraperIngestion from "../scraperIngestion.js";
import type * as standards from "../standards.js";
import type * as wsoRecords from "../wsoRecords.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  athletes: typeof athletes;
  crons: typeof crons;
  http: typeof http;
  intlRankings: typeof intlRankings;
  liftingResults: typeof liftingResults;
  meetStatusJob: typeof meetStatusJob;
  meets: typeof meets;
  notificationPreferences: typeof notificationPreferences;
  pushNotifications: typeof pushNotifications;
  qualifyingTotals: typeof qualifyingTotals;
  records: typeof records;
  savedSessions: typeof savedSessions;
  schedule: typeof schedule;
  scraperIngestion: typeof scraperIngestion;
  standards: typeof standards;
  wsoRecords: typeof wsoRecords;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
