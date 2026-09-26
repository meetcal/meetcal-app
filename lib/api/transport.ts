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

export const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? '';

let sharedClient: ConvexClient | null = null;

function publicClient(): ConvexClient {
  if (!CONVEX_URL) throw new Error('EXPO_PUBLIC_CONVEX_URL is not set');
  sharedClient ??= new ConvexClient(CONVEX_URL, { unsavedChangesWarning: false });
  return sharedClient;
}

function functionReference(fn: string): any {
  const [module, name] = fn.split(':');
  if (!module || !name) throw new Error(`invalid Convex function name ${JSON.stringify(fn)}`);
  return (anyApi as any)[module][name];
}

/**
 * `ConvexError`s thrown by our functions carry `{ status, error }`; they become
 * `TransportRequestError`s so callers keep branching on the HTTP status the
 * Rust API used. Anything else (network, server fault) propagates as is.
 */
function toTransportError(call: ApiCall, error: unknown): unknown {
  if (error instanceof ConvexError) {
    const data = error.data as { status?: unknown; error?: unknown } | undefined;
    const status = typeof data?.status === 'number' ? data.status : 400;
    const body = JSON.stringify(data ?? null);
    return new TransportRequestError(`${call.kind} ${call.path} failed with ${status}`, status, body);
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
  try {
    if (call.token) {
      const http = new ConvexHttpClient(CONVEX_URL);
      http.setAuth(call.token);
      return call.kind === 'query' ? await http.query(ref, args) : await http.mutation(ref, args);
    }
    const client = publicClient();
    return call.kind === 'query' ? await client.query(ref, args) : await client.mutation(ref, args);
  } catch (error) {
    throw toTransportError(call, error);
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
