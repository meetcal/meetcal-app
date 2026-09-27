import { ConvexClient, ConvexHttpClient } from 'convex/browser';
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
 * Public reads go over one shared WebSocket (`ConvexClient`), so a request
 * costs a frame on an open connection rather than an HTTP round trip.
 * Signed-in calls carry the caller's Clerk token on a short-lived
 * `ConvexHttpClient`, so one user's token is never attached to the shared
 * connection.
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

let sharedClient: ConvexClient | null = null;

function publicClient(): ConvexClient {
  sharedClient ??= new ConvexClient(CONVEX_URL, { unsavedChangesWarning: false });
  return sharedClient;
}

/**
 * Drops the shared connection so the next read opens a fresh one. The Convex
 * client only reconnects early on a browser `online` event, which React
 * Native never fires; otherwise a socket that died with the network (a Wi-Fi
 * to cellular switch, a suspended app) is noticed only after a minute of
 * silence, and every read until then waits out its timeout. Reads still in
 * flight on the old connection end with their own timeouts.
 */
export function recycleConnection(): void {
  const client = sharedClient;
  sharedClient = null;
  if (client) void client.close().catch(() => {});
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
 *   queued write the server will never accept is dropped, not retried.
 *
 * Anything else (network, server fault) propagates as is.
 */
function toTransportError(call: ApiCall, error: unknown, httpStatus: number | null): unknown {
  if (error instanceof ConvexError) {
    const data = error.data as { status?: unknown; error?: unknown } | undefined;
    const status = typeof data?.status === 'number' ? data.status : 400;
    const body = JSON.stringify(data ?? null);
    return new TransportRequestError(`${call.kind} ${call.path} failed with ${status}`, status, body);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (httpStatus === 401 || httpStatus === 403) {
    return new TransportRequestError(`${call.kind} ${call.path} failed with 401`, 401, message);
  }
  if (/\bArgumentValidationError\b/.test(message)) {
    return new TransportRequestError(`${call.kind} ${call.path} failed with 400`, 400, message);
  }
  return error;
}

/** Convex values have no `undefined`; an absent optional argument is an absent key. */
function definedArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) if (value !== undefined) out[key] = value;
  return out;
}

export const convexTransport: Transport = async (call) => {
  const ref = functionReference(call.fn);
  const args = definedArgs(call.args);
  // The HTTP client reports a refused request as a bare `Error` with the
  // response text; the status it came with is kept here.
  let httpStatus: number | null = null;
  try {
    if (call.token) {
      const http = new ConvexHttpClient(CONVEX_URL, {
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          httpStatus = response.status;
          return response;
        },
      });
      http.setAuth(call.token);
      return call.kind === 'query' ? await http.query(ref, args) : await http.mutation(ref, args);
    }
    const client = publicClient();
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
