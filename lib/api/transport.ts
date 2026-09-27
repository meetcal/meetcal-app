import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { ConvexError } from 'convex/values';

/**
 * The one place the app talks to its backend: Convex functions, called by
 * `lib/api/meetcal-api.ts`.
 *
 * Every call names the Rust route it replaced (`path`) as well as the Convex
 * function (`fn`): the path keeps logs, errors and test stubs readable, and
 * tests swap the whole transport with `setApiTransportForTests`.
 *
 * Every call is an HTTP request (`ConvexHttpClient`), not a frame on Convex's
 * WebSocket: iOS's WebSocket (SocketRocket) cannot negotiate compression, so
 * answers arrived there uncompressed, while the OS's HTTP stack gets them
 * gzipped, 5-20x smaller (a national meet's package is 978 KB on the socket,
 * 120 KB over HTTP). HTTP also fails at once when the network is gone,
 * where a socket that died with the network lingers. Convex serves both from
 * the same query cache. Signed-in calls carry the caller's Clerk token on a
 * client of their own, so one user's token is never attached to the shared
 * one.
 */
export type ApiCall = {
  /** The Rust route this call replaces, e.g. `/meets/package`. */
  path: string;
  /** The Convex function, `module:function`. */
  fn: string;
  kind: 'query' | 'mutation';
  args: Record<string, unknown>;
  /**
   * The function answers `{ etag, body? }` and takes `ifNoneMatch`: the body
   * is left out when the caller already holds the version named by `etag`.
   */
  conditional?: boolean;
  /** Clerk session token for `/users/me/*`. */
  token?: string;
  /**
   * Aborts the request (the caller's timeout). A timed-out write must not
   * stay in flight: it could reach the server after a newer write to the same
   * row and undo it.
   */
  signal?: AbortSignal;
};

export type Transport = (call: ApiCall) => Promise<unknown>;

/** A Convex function rejected the request (`ConvexError` with an HTTP status). */
export class TransportRequestError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'TransportRequestError';
    this.status = status;
    this.body = body;
  }
}

/**
 * The production deployment, used when the build set no URL (as the iOS App
 * Intents do). Dev builds point elsewhere through `EXPO_PUBLIC_CONVEX_URL`.
 */
export const PRODUCTION_CONVEX_URL = 'https://disciplined-hare-790.convex.cloud';

export const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL || PRODUCTION_CONVEX_URL;

/**
 * A client whose requests record the HTTP status they were answered with: the
 * client reports a refused request as a bare `Error` with the response text.
 */
function httpClient(onStatus: (status: number) => void, signal: AbortSignal | undefined): ConvexHttpClient {
  return new ConvexHttpClient(CONVEX_URL, {
    // Functions' log lines are for the Convex dashboard, not the app console.
    logger: false,
    fetch: async (input, init) => {
      const response = await fetch(input, signal ? { ...init, signal } : init);
      onStatus(response.status);
      return response;
    },
  });
}

function functionReference(fn: string): any {
  const [module, name] = fn.split(':');
  if (!module || !name) throw new Error(`invalid Convex function name ${JSON.stringify(fn)}`);
  return (anyApi as any)[module][name];
}

/**
 * Errors become `TransportRequestError`s wherever the Rust API answered with a
 * status, so callers keep branching on it:
 *
 * - a `ConvexError` from our functions carries `{ status, error }`;
 * - a signed-in call Convex refused over HTTP 401/403 (an expired token, or
 *   one it cannot verify) is the Rust API's 401, so the app shows "sign in
 *   again" instead of retrying forever;
 * - arguments the function's validator rejects are the Rust API's 400, so a
 *   queued write the server will never accept is dropped, not retried;
 * - any other 4xx Convex itself answers a signed-in call with (an unknown
 *   function, a payload over its size limit) keeps its status for the same
 *   reason. Only Convex's JSON error body counts: a proxy's or captive
 *   portal's 4xx page is the network, and 408/429 stay retryable;
 * - any other failure of a function that ran (answered with an error, over
 *   HTTP 200 or Convex's 560) is the Rust API's 500: the server was reached,
 *   so a queued write is retried later without holding up the ones behind it,
 *   rather than treated as the network being down. Convex's own "busy, try
 *   again" failures stay as they are (callers retry them).
 *
 * Anything else (no network, a gateway error) propagates as is.
 */
function toTransportError(call: ApiCall, error: unknown, httpStatus: number | null): unknown {
  if (error instanceof ConvexError) {
    const data = error.data as { status?: unknown; error?: unknown } | undefined;
    const status = typeof data?.status === 'number' ? data.status : 400;
    const body = JSON.stringify(data ?? null);
    return new TransportRequestError(`${call.kind} ${call.path} failed with ${status}`, status, body);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (call.token && (httpStatus === 401 || httpStatus === 403)) {
    return new TransportRequestError(`${call.kind} ${call.path} failed with 401`, 401, message);
  }
  if (call.token && httpStatus !== null && isConvexRefusal(httpStatus, message)) {
    return new TransportRequestError(`${call.kind} ${call.path} failed with ${httpStatus}`, httpStatus, message);
  }
  if (/\bArgumentValidationError\b/.test(message)) {
    return new TransportRequestError(`${call.kind} ${call.path} failed with 400`, 400, message);
  }
  // A body that is not Convex's JSON (a captive portal's login page, a
  // connection cut mid-body) fails to parse: that is the network, not a
  // function that ran.
  const unreadable = error instanceof SyntaxError || error instanceof TypeError;
  const functionRan = !unreadable && httpStatus !== null && (httpStatus === 560 || (httpStatus >= 200 && httpStatus < 300));
  if (functionRan && !CONVEX_TRANSIENT_MESSAGE.test(message)) {
    return new TransportRequestError(`${call.kind} ${call.path} failed with 500`, 500, message);
  }
  return error;
}

/**
 * A 4xx Convex answered with its own `{ code, message }` body, which a retry
 * cannot change. 401/403 are handled as sign-in failures before this; 408 and
 * 429 are "try again", not refusals.
 */
function isConvexRefusal(status: number, responseText: string): boolean {
  if (status < 400 || status >= 500 || status === 401 || status === 403 || status === 408 || status === 429) return false;
  let body: unknown;
  try {
    body = JSON.parse(responseText);
  } catch {
    return false;
  }
  return typeof body === 'object' && body !== null && typeof (body as { code?: unknown }).code === 'string';
}

/** Convex's "busy, try again" failures (overload, rate limits), left for callers to retry. */
export const CONVEX_TRANSIENT_MESSAGE = /try again later|too many (?:concurrent )?requests|overloaded|temporarily unavailable/i;

/** Convex values have no `undefined`; an absent optional argument is an absent key. */
function definedArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) if (value !== undefined) out[key] = value;
  return out;
}

export const convexTransport: Transport = async (call) => {
  const ref = functionReference(call.fn);
  const args = definedArgs(call.args);
  let httpStatus: number | null = null;
  const client = httpClient((status) => {
    httpStatus = status;
  }, call.signal);
  if (call.token) client.setAuth(call.token);
  try {
    return call.kind === 'query' ? await client.query(ref, args) : await client.mutation(ref, args);
  } catch (error) {
    throw toTransportError(call, error, httpStatus);
  }
};

let activeTransport: Transport = convexTransport;

export function callApi(call: ApiCall): Promise<unknown> {
  return activeTransport(call);
}

/** Replaces the transport (a stub), or restores Convex with `null`. For tests. */
export function setApiTransportForTests(transport: Transport | null): void {
  activeTransport = transport ?? convexTransport;
}
