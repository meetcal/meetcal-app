import type { ApiCall, Transport } from '@/lib/api/transport';

/**
 * Test-only transport stub for `lib/api/meetcal-api.ts`.
 *
 * Fetcher tests that stub the transport instead of mocking the API module keep
 * the real boundary validators in the path, so a malformed row in a test
 * payload is handled exactly as it would be in the app.
 *
 * The responder sees each call as the Rust route it replaced: the route path,
 * and the arguments as that route's query parameters (snake_case, strings,
 * lists comma-joined). The client's clock sample never reaches the
 * responder.
 */
export type JsonResponder = (
  path: string,
  query: Record<string, string>,
) => unknown | Promise<unknown>;

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function callQuery(call: ApiCall): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(call.args)) {
    if (value === undefined || key === 'ifNoneMatch') continue;
    query[snakeCase(key)] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return query;
}

/** The client samples the server clock alongside requests; stubs answer it themselves. */
export function isClockCall(call: ApiCall): boolean {
  return call.fn === 'system:serverTime';
}

/** Functions whose rows travel as JSON text (`{ json }`), as `convex/` sends them. */
const TEXT_ANSWERS: ReadonlySet<string> = new Set([
  'meets:athletes',
  'meets:athletesSessions',
  'results:byNames',
  'results:recent',
]);

/**
 * Answers in the production wire shape: conditional calls as `{ json }` (no
 * `etag`, so nothing is remembered), row lists as `{ json }`, the rest as the
 * value itself.
 */
export function jsonTransportStub(respond: JsonResponder): Transport {
  return async (call) => {
    if (isClockCall(call)) return Date.now();
    const body = await respond(call.path, callQuery(call));
    if (call.conditional || TEXT_ANSWERS.has(call.fn)) return { json: JSON.stringify(body) };
    return body;
  };
}
