import { isRecord } from '@/lib/is-record';
import { accessPassFor, wantsAccessPass } from '@/lib/api/premium-queries';
import { callApi, TransportRequestError, type ApiCall } from '@/lib/api/transport';
import { sampleServerClockWhenStale } from '@/lib/api/server-clock';

const DEFAULT_TIMEOUT_MS = 10000;

const SLOW_API_LOG_THRESHOLD_MS = 500;

export function requireToken(token: string | null | undefined, label: string): string {
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error(`${label} requires an auth token`);
  }
  return token;
}

export class MeetCalApiError extends Error {
  status: number;
  body: string;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, body: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'MeetCalApiError';
    this.status = status;
    this.body = body;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class MeetCalApiTimeoutError extends Error {
  path: string;
  timeoutMs: number;

  constructor(method: string, path: string, timeoutMs: number, message?: string) {
    super(message ?? `${method} ${path} timed out after ${timeoutMs}ms`);
    this.name = 'MeetCalApiTimeoutError';
    this.path = path;
    this.timeoutMs = timeoutMs;
  }
}

function methodLabel(call: ApiCall): string {
  return call.kind === 'mutation' || call.kind === 'action' ? 'POST' : 'GET';
}

export async function request(call: ApiCall, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  if (call.kind !== 'query' || call.token || !wantsAccessPass(call.fn, call.args)) return send(call, timeoutMs);
  const pass = await accessPassFor(call.fn, call.args);
  try {
    return await send(withPass(call, pass), timeoutMs);
  } catch (error) {
    if (!(error instanceof MeetCalApiError) || (error.status !== 401 && error.status !== 403)) throw error;
    const fresh = await accessPassFor(call.fn, call.args, { refused: pass, retry: true });
    if (fresh === undefined || fresh === pass) throw error;
    return await send(withPass(call, fresh), timeoutMs);
  }
}

function withPass(call: ApiCall, pass: string | undefined): ApiCall {
  return pass === undefined ? call : { ...call, args: { ...call.args, pass } };
}

async function send(call: ApiCall, timeoutMs: number): Promise<unknown> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new MeetCalApiTimeoutError(methodLabel(call), call.path, timeoutMs));
      abort?.abort();
    }, timeoutMs);
  });
  sampleServerClockWhenStale();

  try {
    return await Promise.race([callApi(abort ? { ...call, signal: abort.signal } : call), timeout]);
  } catch (error) {
    if (error instanceof TransportRequestError) {
      throw new MeetCalApiError(error.message, error.status, error.body);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      const elapsedMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt,
      );
      if (elapsedMs >= SLOW_API_LOG_THRESHOLD_MS) {
        console.info('[perf] slow api request', { elapsedMs, path: call.path, fn: call.fn });
      }
    }
  }
}

export function readQuery(path: string, fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return request({ path, fn, kind: 'query', args });
}

function parseJsonText(text: string, path: string): unknown {
  if (text.length === 0) throw new Error(`${path} returned an empty body`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} returned invalid JSON`);
  }
}

export function decodeJsonText(value: unknown, path: string): unknown {
  if (isRecord(value) && 'json' in value) {
    const { json } = value;
    if (typeof json !== 'string') throw new Error(`${path} returned a non-text json field`);
    return parseJsonText(json, path);
  }
  return value;
}

export function userCall(
  path: string,
  fn: string,
  kind: ApiCall['kind'],
  token: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return request({ path, fn, kind, args, token });
}
