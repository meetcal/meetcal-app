import { clearHttpValidatorCache } from '@/lib/api/revalidated-reads';
import { fetchApiClubMeets } from '@/lib/api/clubs-api';
import { resetServerClockForTests } from '@/lib/api/server-clock';
import { isClockCall } from './json-transport-stub';
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

describe('club meets (#209)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('asks for the club once and answers its meets in the order sent, without the extra fields', async () => {
    const { dataCalls } = installTransport(
      answer({
        meets: [
          { meet: 'Meet B', date: '2026-03-27', status: 'completed', has_results: true },
          { meet: 'Meet A', date: null, status: null, has_results: false },
        ],
        truncated: false,
      }),
    );

    await expect(fetchApiClubMeets('Club A')).resolves.toEqual([
      { meet: 'Meet B', date: '2026-03-27' },
      { meet: 'Meet A', date: null },
    ]);
    expect(dataCalls().map((call) => [call.fn, call.args])).toEqual([['reference:clubMeets', { club: 'Club A' }]]);
  });

  it('drops a meet without a name, reads a date that is not text as none, and says how many went', async () => {
    installTransport(
      answer({
        meets: [
          { meet: 'Meet A', date: 20260327 },
          { meet: '', date: '2026-01-01' },
          { date: '2026-01-01' },
          null,
          ['Meet C'],
          { meet: 'Meet D', date: '2026-01-02' },
        ],
        truncated: false,
      }),
    );

    await expect(fetchApiClubMeets('Club A')).resolves.toEqual([
      { meet: 'Meet A', date: null },
      { meet: 'Meet D', date: '2026-01-02' },
    ]);
    expect(console.warn).toHaveBeenCalledWith('[api] /clubs/meets: dropped 4 of 6 malformed meets');
  });

  it.each([
    ['a plain array', [], '/clubs/meets expected an object response'],
    ['no meets', { truncated: false }, '/clubs/meets expected an array response'],
    ['meets that are not a list', { meets: { meet: 'Meet A' } }, '/clubs/meets expected an array response'],
  ])('rejects an answer with %s', async (_name, body, message) => {
    installTransport(answer(body));
    await expect(fetchApiClubMeets('Club A')).rejects.toThrow(message);
  });
});
