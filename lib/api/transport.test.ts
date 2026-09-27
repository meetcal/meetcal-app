import { convexTransport, TransportRequestError, type ApiCall } from './transport';

type StubResponse = { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> };

const realFetch = global.fetch;
let responses: StubResponse[] = [];

function respond(status: number, body: unknown): StubResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

const signedIn: ApiCall = {
  path: '/users/me/saved-sessions',
  fn: 'users:listSavedSessions',
  kind: 'query',
  args: {},
  token: 'token',
};

beforeEach(() => {
  responses = [];
  global.fetch = jest.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no stubbed response');
    return next as unknown as Response;
  }) as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

async function failure(call: ApiCall): Promise<unknown> {
  return convexTransport(call).then(
    () => {
      throw new Error('expected the call to fail');
    },
    (error: unknown) => error,
  );
}

describe('convexTransport (public calls over HTTP)', () => {
  const publicCall: ApiCall = { path: '/meets', fn: 'meets:list', kind: 'query', args: { now: 0, ifNoneMatch: undefined } };

  it('sends a public read as an HTTP query with no token and absent optional arguments left out', async () => {
    responses.push(respond(200, { status: 'success', value: { etag: '"v1"', json: '[]' } }));
    await expect(convexTransport(publicCall)).resolves.toEqual({ etag: '"v1"', json: '[]' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/query$/);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    const body = JSON.parse(String(init.body)) as { path: string; args: Record<string, unknown>[] };
    expect(body.path).toBe('meets:list');
    expect(body.args[0]).toEqual({ now: 0 });
  });

  it('fails at once, as the network error, when there is no network', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(convexTransport(publicCall)).rejects.toBeInstanceOf(TypeError);
  });

  it('does not treat a 401 on a call that sent no token as an expired sign-in', async () => {
    responses.push(respond(401, 'Unauthorized'));
    const error = await failure(publicCall);
    expect(error).not.toBeInstanceOf(TransportRequestError);
  });
});

describe('convexTransport (signed-in calls over HTTP)', () => {
  it('returns the value of a successful call, sending the token', async () => {
    responses.push(respond(200, { status: 'success', value: [{ id: 's1' }] }));
    await expect(convexTransport(signedIn)).resolves.toEqual([{ id: 's1' }]);
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('turns a token Convex refuses (HTTP 401) into the 401 the app signs in again on', async () => {
    responses.push(respond(401, { code: 'InvalidAuthHeader', message: 'Token expired' }));
    const error = await failure(signedIn);
    expect(error).toBeInstanceOf(TransportRequestError);
    expect((error as TransportRequestError).status).toBe(401);
    expect((error as TransportRequestError).body).toContain('Token expired');
  });

  it('treats an HTTP 403 the same way', async () => {
    responses.push(respond(403, 'Forbidden'));
    expect(((await failure(signedIn)) as TransportRequestError).status).toBe(401);
  });

  it('turns arguments the validator rejects into a 400, so a queued write is dropped', async () => {
    responses.push(
      respond(200, {
        status: 'error',
        errorMessage: '[Request ID: 1] Server Error\nArgumentValidationError: Object is missing the required field `id`.',
      }),
    );
    const error = await failure({ ...signedIn, kind: 'mutation' });
    expect(error).toBeInstanceOf(TransportRequestError);
    expect((error as TransportRequestError).status).toBe(400);
  });

  it('keeps the status a ConvexError from our functions carries', async () => {
    responses.push(respond(200, { status: 'error', errorMessage: 'not found', errorData: { status: 404, error: 'not found' } }));
    const error = await failure(signedIn);
    expect((error as TransportRequestError).status).toBe(404);
  });

  it('lets a server fault and a network failure through unchanged', async () => {
    responses.push(respond(500, 'Internal Server Error'));
    const fault = await failure(signedIn);
    expect(fault).not.toBeInstanceOf(TransportRequestError);
    expect((fault as Error).message).toContain('Internal Server Error');

    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));
    const offline = await failure(signedIn);
    expect(offline).toBeInstanceOf(TypeError);
  });

  it('rejects a malformed function name before calling anything', async () => {
    await expect(convexTransport({ ...signedIn, fn: 'nocolon' })).rejects.toThrow('invalid Convex function name');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
