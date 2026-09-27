/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as ingest from "../ingest.js";
import type * as lib_directory from "../lib/directory.js";
import type * as lib_etag from "../lib/etag.js";
import type * as lib_history from "../lib/history.js";
import type * as lib_meetData from "../lib/meetData.js";
import type * as lib_names from "../lib/names.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_referenceData from "../lib/referenceData.js";
import type * as lib_results from "../lib/results.js";
import type * as lib_sort from "../lib/sort.js";
import type * as lib_validation from "../lib/validation.js";
import type * as lib_viewKeys from "../lib/viewKeys.js";
import type * as lib_views from "../lib/views.js";
import type * as meets from "../meets.js";
import type * as migrations from "../migrations.js";
import type * as parity from "../parity.js";
import type * as reference from "../reference.js";
import type * as results from "../results.js";
import type * as scrapers_intlRankings from "../scrapers/intlRankings.js";
import type * as scrapers_lib_csv from "../scrapers/lib/csv.js";
import type * as scrapers_lib_html from "../scrapers/lib/html.js";
import type * as scrapers_lib_http from "../scrapers/lib/http.js";
import type * as scrapers_lib_pdf from "../scrapers/lib/pdf.js";
import type * as scrapers_lib_slack from "../scrapers/lib/slack.js";
import type * as scrapers_parse_intlRankings from "../scrapers/parse/intlRankings.js";
import type * as scrapers_parse_records from "../scrapers/parse/records.js";
import type * as scrapers_parse_standards from "../scrapers/parse/standards.js";
import type * as scrapers_parse_umwf from "../scrapers/parse/umwf.js";
import type * as scrapers_parse_usamw from "../scrapers/parse/usamw.js";
import type * as scrapers_probe from "../scrapers/probe.js";
import type * as scrapers_records from "../scrapers/records.js";
import type * as scrapers_standards from "../scrapers/standards.js";
import type * as scrapers_umwf from "../scrapers/umwf.js";
import type * as scrapers_usamw from "../scrapers/usamw.js";
import type * as system from "../system.js";
import type * as users from "../users.js";
import type * as views from "../views.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  ingest: typeof ingest;
  "lib/directory": typeof lib_directory;
  "lib/etag": typeof lib_etag;
  "lib/history": typeof lib_history;
  "lib/meetData": typeof lib_meetData;
  "lib/names": typeof lib_names;
  "lib/normalize": typeof lib_normalize;
  "lib/referenceData": typeof lib_referenceData;
  "lib/results": typeof lib_results;
  "lib/sort": typeof lib_sort;
  "lib/validation": typeof lib_validation;
  "lib/viewKeys": typeof lib_viewKeys;
  "lib/views": typeof lib_views;
  meets: typeof meets;
  migrations: typeof migrations;
  parity: typeof parity;
  reference: typeof reference;
  results: typeof results;
  "scrapers/intlRankings": typeof scrapers_intlRankings;
  "scrapers/lib/csv": typeof scrapers_lib_csv;
  "scrapers/lib/html": typeof scrapers_lib_html;
  "scrapers/lib/http": typeof scrapers_lib_http;
  "scrapers/lib/pdf": typeof scrapers_lib_pdf;
  "scrapers/lib/slack": typeof scrapers_lib_slack;
  "scrapers/parse/intlRankings": typeof scrapers_parse_intlRankings;
  "scrapers/parse/records": typeof scrapers_parse_records;
  "scrapers/parse/standards": typeof scrapers_parse_standards;
  "scrapers/parse/umwf": typeof scrapers_parse_umwf;
  "scrapers/parse/usamw": typeof scrapers_parse_usamw;
  "scrapers/probe": typeof scrapers_probe;
  "scrapers/records": typeof scrapers_records;
  "scrapers/standards": typeof scrapers_standards;
  "scrapers/umwf": typeof scrapers_umwf;
  "scrapers/usamw": typeof scrapers_usamw;
  system: typeof system;
  users: typeof users;
  views: typeof views;
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
