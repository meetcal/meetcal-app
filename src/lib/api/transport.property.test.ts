import * as fc from 'fast-check';

import { CONVEX_TRANSIENT_MESSAGE, convexTransport, TransportRequestError, type ApiCall } from './transport';

/**
 * `toTransportError`'s rules (the doc comment in transport.ts), checked
 * through `convexTransport` against generated HTTP answers: the
 * `ConvexHttpClient` calls global `fetch`, stubbed here per case.
 */

type StubResponse = { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> };

const realFetch = global.fetch;

function respond(status: number, text: string): StubResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

afterEach(() => {
  global.fetch = realFetch;
});

/** Messages a body can carry. None names `ArgumentValidationError`; that rule has its own property. */
const MESSAGES = [
  '[Request ID: 1] Server Error',
  'Uncaught Error: boom',
  'Token expired',
  'Could not find public function',
  "Your request couldn't be completed. Try again later.",
  'Too many concurrent requests',
  'Service temporarily unavailable',
] as const;

const messageArb = fc.oneof(fc.constantFrom(...MESSAGES), fc.string({ maxLength: 20 }));

/** A 4xx/5xx body: Convex's `{ code, message }`, other JSON, or a page that is not JSON. */
type Body = { kind: 'convex'; code: string } | { kind: 'json' } | { kind: 'text' };

const bodyArb = fc.oneof(
  fc.record({ kind: fc.constant('convex' as const), code: fc.constantFrom('InvalidAuthHeader', 'FunctionNotFound', 'RateLimited', 'BadRequest') }),
  fc.constant<Body>({ kind: 'json' }),
  fc.constant<Body>({ kind: 'text' }),
);

function bodyText(body: Body, message: string): string {
  if (body.kind === 'convex') return JSON.stringify({ code: body.code, message });
  if (body.kind === 'json') return JSON.stringify({ message, code: 7 });
  return `<html>${message}</html>`;
}

const callArb: fc.Arbitrary<ApiCall> = fc.record({
  path: fc.constantFrom('/users/me/saved-sessions', '/meets'),
  fn: fc.constantFrom('users:savedSessions', 'meets:list'),
  kind: fc.constantFrom('query' as const, 'mutation' as const),
  args: fc.constant({}),
  token: fc.option(fc.constant('token'), { nil: undefined }),
});

async function failure(call: ApiCall, response: StubResponse): Promise<unknown> {
  global.fetch = jest.fn(async () => response as unknown as Response) as typeof fetch;
  return convexTransport(call).then(
    (value: unknown) => ({ resolved: value }),
    (error: unknown) => error,
  );
}

function expectStatus(error: unknown, status: number) {
  expect(error).toBeInstanceOf(TransportRequestError);
  expect((error as TransportRequestError).status).toBe(status);
}

describe('convexTransport error classification (properties)', () => {
  it('turns a signed-in call refused with HTTP 401 or 403 into a 401, whatever the body', async () => {
    await fc.assert(
      fc.asyncProperty(callArb, fc.constantFrom(401, 403), bodyArb, messageArb, async (call, status, body, message) => {
        const error = await failure({ ...call, token: 'token' }, respond(status, bodyText(body, message)));
        expectStatus(error, 401);
      }),
    );
  });

  it('keeps the status of a 4xx Convex refuses a signed-in call with, but never 408 or 429', async () => {
    await fc.assert(
      fc.asyncProperty(
        callArb,
        fc.integer({ min: 400, max: 499 }).filter((status) => status !== 401 && status !== 403),
        fc.string({ maxLength: 12 }),
        messageArb,
        async (call, status, code, message) => {
          const error = await failure({ ...call, token: 'token' }, respond(status, JSON.stringify({ code, message })));
          if (status === 408 || status === 429) expect(error).not.toBeInstanceOf(TransportRequestError);
          else expectStatus(error, status);
        },
      ),
    );
  });

  it('leaves every other HTTP failure as the network error, carrying the body', async () => {
    // A public call's 4xx, a 4xx whose body is not Convex's JSON (a proxy or
    // captive portal), 408/429 and gateway errors are retried, not refusals.
    await fc.assert(
      fc.asyncProperty(
        callArb,
        fc.integer({ min: 400, max: 599 }).filter((status) => status !== 560),
        bodyArb,
        messageArb,
        async (call, status, body, message) => {
          const signedIn = call.token !== undefined;
          const authFailure = signedIn && (status === 401 || status === 403);
          const refusal = signedIn && status < 500 && status !== 408 && status !== 429 && body.kind === 'convex';
          fc.pre(!authFailure && !refusal);
          const text = bodyText(body, message);
          const error = await failure(call, respond(status, text));
          expect(error).not.toBeInstanceOf(TransportRequestError);
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe(text);
        },
      ),
    );
  });

  it('keeps the status a ConvexError carries, or 400 when it carries none', async () => {
    await fc.assert(
      fc.asyncProperty(
        callArb,
        fc.constantFrom(200, 560),
        fc.oneof(fc.integer({ min: 400, max: 599 }), fc.string({ maxLength: 4 }), fc.constant(undefined)),
        messageArb,
        async (call, httpStatus, status, message) => {
          const errorData = status === undefined ? { error: message } : { status, error: message };
          const error = await failure(call, respond(httpStatus, JSON.stringify({ status: 'error', errorMessage: message, errorData })));
          expectStatus(error, typeof status === 'number' ? status : 400);
          expect(JSON.parse((error as TransportRequestError).body)).toEqual(errorData);
        },
      ),
    );
  });

  it('turns a function that ran and failed into a 500, except Convex\'s "try again" and argument validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        callArb,
        fc.constantFrom(200, 560),
        fc.oneof(messageArb, messageArb.map((message) => `${message}\nArgumentValidationError: Object is missing the required field \`id\`.`)),
        async (call, httpStatus, message) => {
          const error = await failure(call, respond(httpStatus, JSON.stringify({ status: 'error', errorMessage: message })));
          if (/\bArgumentValidationError\b/.test(message)) expectStatus(error, 400);
          else if (CONVEX_TRANSIENT_MESSAGE.test(message)) {
            expect(error).not.toBeInstanceOf(TransportRequestError);
            expect((error as Error).message).toBe(message);
          } else expectStatus(error, 500);
        },
      ),
    );
  });

  it('treats a 2xx or 560 body that is not JSON as the network, not a function that ran', async () => {
    await fc.assert(
      fc.asyncProperty(
        callArb,
        fc.oneof(fc.integer({ min: 200, max: 299 }), fc.constant(560)),
        fc.oneof(fc.constant(''), messageArb.map((message) => `<html>${message}</html>`)),
        async (call, status, text) => {
          const error = await failure(call, respond(status, text));
          expect(error).toBeInstanceOf(SyntaxError);
        },
      ),
    );
  });

  it('returns the value of a successful call, and passes a fetch failure through as is', async () => {
    await fc.assert(
      fc.asyncProperty(
        callArb,
        fc.oneof(fc.string(), fc.integer(), fc.array(fc.string(), { maxLength: 3 }), fc.dictionary(fc.stringMatching(/^[a-z]{1,6}$/), fc.integer())),
        async (call, value) => {
          await expect(failure(call, respond(200, JSON.stringify({ status: 'success', value })))).resolves.toEqual({ resolved: value });

          const offline = new TypeError('Network request failed');
          global.fetch = jest.fn(async () => {
            throw offline;
          }) as typeof fetch;
          await expect(convexTransport(call)).rejects.toBe(offline);
        },
      ),
    );
  });
});
