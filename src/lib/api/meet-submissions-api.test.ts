import { clearHttpValidatorCache } from '@/lib/api/revalidated-reads';
import { resetServerClockForTests } from '@/lib/api/server-clock';
import { generateMeetSubmissionUploadUrl, submitMeet } from '@/lib/api/meet-submissions-api';
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

describe('meet submissions', () => {
  it('asks for an upload URL with the Clerk token, and checks it is https', async () => {
    const { lastCall } = installTransport(() => ({ uploadUrl: 'https://x.convex.cloud/api/storage/upload?token=1' }));
    await expect(generateMeetSubmissionUploadUrl('clerk-token')).resolves.toBe('https://x.convex.cloud/api/storage/upload?token=1');
    expect(lastCall()).toMatchObject({ fn: 'meetSubmissions:generateUploadUrl', kind: 'mutation', token: 'clerk-token', args: {} });
    installTransport(() => ({ uploadUrl: 'javascript:alert(1)' }));
    await expect(generateMeetSubmissionUploadUrl('clerk-token')).rejects.toThrow('expected an https URL');
    await expect(generateMeetSubmissionUploadUrl('')).rejects.toThrow('requires an auth token');
  });

  it('submits the meet with the Clerk token, and needs the acknowledgement', async () => {
    const body = { meetName: 'Open', startDate: '2027-03-06', endDate: null, contactEmail: null, files: [{ storageId: 's1', name: 'a.pdf' }] };
    const { lastCall } = installTransport(() => ({ submitted: true }));
    await expect(submitMeet('clerk-token', body)).resolves.toBeUndefined();
    expect(lastCall()).toMatchObject({ fn: 'meetSubmissions:submit', kind: 'mutation', token: 'clerk-token', args: body });
    installTransport(() => ({ submitted: 'yes' }));
    await expect(submitMeet('clerk-token', body)).rejects.toThrow('expected true');
    installTransport(() => null);
    await expect(submitMeet('clerk-token', body)).rejects.toThrow();
  });
});
