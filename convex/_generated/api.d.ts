/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cronJobs from "../cronJobs.js";
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
import type * as lib_sentryCrons from "../lib/sentryCrons.js";
import type * as lib_sort from "../lib/sort.js";
import type * as lib_validation from "../lib/validation.js";
import type * as lib_viewKeys from "../lib/viewKeys.js";
import type * as lib_views from "../lib/views.js";
import type * as meets from "../meets.js";
import type * as migrations from "../migrations.js";
import type * as parity from "../parity.js";
import type * as reference from "../reference.js";
import type * as results from "../results.js";
import type * as scrapers_entries from "../scrapers/entries.js";
import type * as scrapers_entryTargets from "../scrapers/entryTargets.js";
import type * as scrapers_intlRankings from "../scrapers/intlRankings.js";
import type * as scrapers_iwfRecords from "../scrapers/iwfRecords.js";
import type * as scrapers_lib_csv from "../scrapers/lib/csv.js";
import type * as scrapers_lib_diff from "../scrapers/lib/diff.js";
import type * as scrapers_lib_email from "../scrapers/lib/email.js";
import type * as scrapers_lib_html from "../scrapers/lib/html.js";
import type * as scrapers_lib_http from "../scrapers/lib/http.js";
import type * as scrapers_lib_pdf from "../scrapers/lib/pdf.js";
import type * as scrapers_meets from "../scrapers/meets.js";
import type * as scrapers_parse_entries from "../scrapers/parse/entries.js";
import type * as scrapers_parse_holder from "../scrapers/parse/holder.js";
import type * as scrapers_parse_intlRankings from "../scrapers/parse/intlRankings.js";
import type * as scrapers_parse_iwfRecords from "../scrapers/parse/iwfRecords.js";
import type * as scrapers_parse_meets from "../scrapers/parse/meets.js";
import type * as scrapers_parse_records from "../scrapers/parse/records.js";
import type * as scrapers_parse_sport80 from "../scrapers/parse/sport80.js";
import type * as scrapers_parse_standards from "../scrapers/parse/standards.js";
import type * as scrapers_parse_umwf from "../scrapers/parse/umwf.js";
import type * as scrapers_parse_usamw from "../scrapers/parse/usamw.js";
import type * as scrapers_parse_usamwEvents from "../scrapers/parse/usamwEvents.js";
import type * as scrapers_parse_usamwResults from "../scrapers/parse/usamwResults.js";
import type * as scrapers_parse_watchedPages from "../scrapers/parse/watchedPages.js";
import type * as scrapers_parse_wso_common from "../scrapers/parse/wso/common.js";
import type * as scrapers_parse_wso_flat from "../scrapers/parse/wso/flat.js";
import type * as scrapers_parse_wso_illinois from "../scrapers/parse/wso/illinois.js";
import type * as scrapers_parse_wso_missouriValley from "../scrapers/parse/wso/missouriValley.js";
import type * as scrapers_parse_wso_mountainSouth from "../scrapers/parse/wso/mountainSouth.js";
import type * as scrapers_parse_wso_newEngland from "../scrapers/parse/wso/newEngland.js";
import type * as scrapers_parse_wso_newJersey from "../scrapers/parse/wso/newJersey.js";
import type * as scrapers_parse_wso_newYork from "../scrapers/parse/wso/newYork.js";
import type * as scrapers_parse_wso_ohio from "../scrapers/parse/wso/ohio.js";
import type * as scrapers_parse_wso_pawv from "../scrapers/parse/wso/pawv.js";
import type * as scrapers_parse_wso_sideBySide from "../scrapers/parse/wso/sideBySide.js";
import type * as scrapers_parse_wso_tnky from "../scrapers/parse/wso/tnky.js";
import type * as scrapers_parse_wso_usawTemplate from "../scrapers/parse/wso/usawTemplate.js";
import type * as scrapers_probe from "../scrapers/probe.js";
import type * as scrapers_queries from "../scrapers/queries.js";
import type * as scrapers_records from "../scrapers/records.js";
import type * as scrapers_sport80 from "../scrapers/sport80.js";
import type * as scrapers_standards from "../scrapers/standards.js";
import type * as scrapers_umwf from "../scrapers/umwf.js";
import type * as scrapers_urlwatch from "../scrapers/urlwatch.js";
import type * as scrapers_usamw from "../scrapers/usamw.js";
import type * as scrapers_usamwEvents from "../scrapers/usamwEvents.js";
import type * as scrapers_watchedPageState from "../scrapers/watchedPageState.js";
import type * as scrapers_wsoRecords from "../scrapers/wsoRecords.js";
import type * as system from "../system.js";
import type * as users from "../users.js";
import type * as views from "../views.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  cronJobs: typeof cronJobs;
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
  "lib/sentryCrons": typeof lib_sentryCrons;
  "lib/sort": typeof lib_sort;
  "lib/validation": typeof lib_validation;
  "lib/viewKeys": typeof lib_viewKeys;
  "lib/views": typeof lib_views;
  meets: typeof meets;
  migrations: typeof migrations;
  parity: typeof parity;
  reference: typeof reference;
  results: typeof results;
  "scrapers/entries": typeof scrapers_entries;
  "scrapers/entryTargets": typeof scrapers_entryTargets;
  "scrapers/intlRankings": typeof scrapers_intlRankings;
  "scrapers/iwfRecords": typeof scrapers_iwfRecords;
  "scrapers/lib/csv": typeof scrapers_lib_csv;
  "scrapers/lib/diff": typeof scrapers_lib_diff;
  "scrapers/lib/email": typeof scrapers_lib_email;
  "scrapers/lib/html": typeof scrapers_lib_html;
  "scrapers/lib/http": typeof scrapers_lib_http;
  "scrapers/lib/pdf": typeof scrapers_lib_pdf;
  "scrapers/meets": typeof scrapers_meets;
  "scrapers/parse/entries": typeof scrapers_parse_entries;
  "scrapers/parse/holder": typeof scrapers_parse_holder;
  "scrapers/parse/intlRankings": typeof scrapers_parse_intlRankings;
  "scrapers/parse/iwfRecords": typeof scrapers_parse_iwfRecords;
  "scrapers/parse/meets": typeof scrapers_parse_meets;
  "scrapers/parse/records": typeof scrapers_parse_records;
  "scrapers/parse/sport80": typeof scrapers_parse_sport80;
  "scrapers/parse/standards": typeof scrapers_parse_standards;
  "scrapers/parse/umwf": typeof scrapers_parse_umwf;
  "scrapers/parse/usamw": typeof scrapers_parse_usamw;
  "scrapers/parse/usamwEvents": typeof scrapers_parse_usamwEvents;
  "scrapers/parse/usamwResults": typeof scrapers_parse_usamwResults;
  "scrapers/parse/watchedPages": typeof scrapers_parse_watchedPages;
  "scrapers/parse/wso/common": typeof scrapers_parse_wso_common;
  "scrapers/parse/wso/flat": typeof scrapers_parse_wso_flat;
  "scrapers/parse/wso/illinois": typeof scrapers_parse_wso_illinois;
  "scrapers/parse/wso/missouriValley": typeof scrapers_parse_wso_missouriValley;
  "scrapers/parse/wso/mountainSouth": typeof scrapers_parse_wso_mountainSouth;
  "scrapers/parse/wso/newEngland": typeof scrapers_parse_wso_newEngland;
  "scrapers/parse/wso/newJersey": typeof scrapers_parse_wso_newJersey;
  "scrapers/parse/wso/newYork": typeof scrapers_parse_wso_newYork;
  "scrapers/parse/wso/ohio": typeof scrapers_parse_wso_ohio;
  "scrapers/parse/wso/pawv": typeof scrapers_parse_wso_pawv;
  "scrapers/parse/wso/sideBySide": typeof scrapers_parse_wso_sideBySide;
  "scrapers/parse/wso/tnky": typeof scrapers_parse_wso_tnky;
  "scrapers/parse/wso/usawTemplate": typeof scrapers_parse_wso_usawTemplate;
  "scrapers/probe": typeof scrapers_probe;
  "scrapers/queries": typeof scrapers_queries;
  "scrapers/records": typeof scrapers_records;
  "scrapers/sport80": typeof scrapers_sport80;
  "scrapers/standards": typeof scrapers_standards;
  "scrapers/umwf": typeof scrapers_umwf;
  "scrapers/urlwatch": typeof scrapers_urlwatch;
  "scrapers/usamw": typeof scrapers_usamw;
  "scrapers/usamwEvents": typeof scrapers_usamwEvents;
  "scrapers/watchedPageState": typeof scrapers_watchedPageState;
  "scrapers/wsoRecords": typeof scrapers_wsoRecords;
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
