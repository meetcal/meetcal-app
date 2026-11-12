import { clearHttpValidatorCache } from '@/lib/api/revalidated-reads';
import { fetchApiResultsByNames, SMALL_ROWS_NAMES_CHUNK_SIZE } from '@/lib/api/results-api';
import { resetServerClockForTests } from '@/lib/api/server-clock';
import { callQuery, isClockCall } from './json-transport-stub';
import { setApiTransportForTests, type ApiCall } from './transport';

type Responder = (call: ApiCall) => unknown;

function installTransport(respond: Responder, clock: Responder = () => Date.now()) {
  const transport = jest.fn(
    async (call: ApiCall): Promise<unknown> => (isClockCall(call) ? clock(call) : respond(call)),
  );
  setApiTransportForTests(transport);
  const allCalls = (): ApiCall[] => transport.mock.calls.map(([{ signal: _signal, ...call }]) => call);
  const dataCalls = (): ApiCall[] => allCalls().filter((call) => !isClockCall(call));
  const clockCalls = (): ApiCall[] => allCalls().filter((call) => isClockCall(call));
  const lastCall = (): ApiCall => {
    const calls = dataCalls();
    if (calls.length === 0) throw new Error('no data call was made');
    return calls[calls.length - 1];
  };
  return { transport, dataCalls, clockCalls, lastCall };
}

function answer(body: unknown, etag: string | null = null): Responder {
  return (call) => (call.conditional ? { etag, body } : body);
}

beforeEach(() => {
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  setApiTransportForTests(null);
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('by-names latestOnly', () => {
  it('sends latestOnly only when asked', async () => {
    const { dataCalls } = installTransport(answer([]));

    await fetchApiResultsByNames(['Athlete A'], { latestOnly: true });
    await fetchApiResultsByNames(['Athlete A']);
    await fetchApiResultsByNames(['Athlete A'], { latestOnly: false });

    expect(dataCalls().map((call) => call.args.latestOnly)).toEqual([true, undefined, undefined]);
    expect(dataCalls().map(callQuery)).toEqual([
      { names: 'Athlete A', latest_only: 'true' },
      { names: 'Athlete A' },
      { names: 'Athlete A' },
    ]);
  });

  it('keeps latestOnly on every chunk', async () => {
    const { dataCalls } = installTransport(answer([]));
    const names = Array.from({ length: SMALL_ROWS_NAMES_CHUNK_SIZE + 1 }, (_, i) => `Athlete ${i}`);

    await fetchApiResultsByNames(names, { latestOnly: true });

    expect(dataCalls()).toHaveLength(2);
    for (const call of dataCalls()) {
      expect(call.args.latestOnly).toBe(true);
    }
  });
});
