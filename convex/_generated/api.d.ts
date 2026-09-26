/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ingest from "../ingest.js";
import type * as lib_directory from "../lib/directory.js";
import type * as lib_etag from "../lib/etag.js";
import type * as lib_history from "../lib/history.js";
import type * as lib_meetData from "../lib/meetData.js";
import type * as lib_names from "../lib/names.js";
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
import type * as system from "../system.js";
import type * as users from "../users.js";
import type * as views from "../views.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ingest: typeof ingest;
  "lib/directory": typeof lib_directory;
  "lib/etag": typeof lib_etag;
  "lib/history": typeof lib_history;
  "lib/meetData": typeof lib_meetData;
  "lib/names": typeof lib_names;
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
