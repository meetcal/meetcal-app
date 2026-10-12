import { withTransportFaults, type TransportFault } from '@/lib/api/chaos-transport';
import { TransportRequestError, type ApiCall, type Transport } from '@/lib/api/transport';

const call: ApiCall = { path: '/meets', fn: 'meets:list', kind: 'query', args: {} };
const inner: Transport = async () => ({ json: '{"meets":[1,2,3]}' });

function faulty(fault: TransportFault): Transport {
  return withTransportFaults(inner, () => fault);
}

describe('withTransportFaults', () => {
  it('passes the call through untouched', async () => {
    await expect(faulty({ kind: 'pass' })(call)).resolves.toEqual({ json: '{"meets":[1,2,3]}' });
  });

  it("fails like fetch when the network is gone", async () => {
    await expect(faulty({ kind: 'network' })(call)).rejects.toBeInstanceOf(TypeError);
  });

  it('refuses with the status the server would have answered', async () => {
    const error = await faulty({ kind: 'status', status: 503 })(call).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportRequestError);
    expect((error as TransportRequestError).status).toBe(503);
  });

  it("fails with Convex's retryable message", async () => {
    await expect(faulty({ kind: 'transient' })(call)).rejects.toThrow(/try again later/);
  });

  it('answers garbage instead of the real value', async () => {
    await expect(faulty({ kind: 'garbage', value: '<html>' })(call)).resolves.toBe('<html>');
  });

  it('cuts the JSON text short', async () => {
    await expect(faulty({ kind: 'truncate' })(call)).resolves.toEqual({ json: '{"meets"' });
  });

  it('cuts a value answer as JSON text', async () => {
    const value = withTransportFaults(async () => ({ a: 1 }), () => ({ kind: 'truncate' }));
    await expect(value(call)).resolves.toEqual({ json: '{"a' });
  });

  it('hangs until the caller aborts', async () => {
    const abort = new AbortController();
    const pending = faulty({ kind: 'hang' })({ ...call, signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects at once when the caller already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(faulty({ kind: 'delay', ms: 10 })({ ...call, signal: abort.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('answers late, and not at all once aborted', async () => {
    jest.useFakeTimers();
    try {
      const late = faulty({ kind: 'delay', ms: 5_000 })(call);
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(late).resolves.toEqual({ json: '{"meets":[1,2,3]}' });

      const abort = new AbortController();
      const aborted = faulty({ kind: 'delay', ms: 5_000 })({ ...call, signal: abort.signal });
      abort.abort();
      await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      jest.useRealTimers();
    }
  });
});
