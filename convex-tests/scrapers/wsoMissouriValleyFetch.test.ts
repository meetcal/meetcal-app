import { fetchText } from '../../convex/scrapers/lib/http';
import { fetchMissouriValleyPage } from '../../convex/scrapers/lib/missouriValley';

jest.mock('../../convex/scrapers/lib/http', () => ({ fetchText: jest.fn() }));
const fetchMock = jest.mocked(fetchText);
const socketFailure = (code: string) => new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });

describe('Missouri Valley transient fetch failures', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('recovers after a connection reset and connect timeout, using bounded backoff', async () => {
    fetchMock.mockRejectedValueOnce(socketFailure('ECONNRESET'))
      .mockRejectedValueOnce(socketFailure('UND_ERR_CONNECT_TIMEOUT'))
      .mockResolvedValueOnce('<h2>Records</h2>');
    const result = fetchMissouriValleyPage();
    await jest.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBe('<h2>Records</h2>');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith('https://missourivalleyweightlifting.org/records/', 45_000);
  });

  it('retries a request timeout', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce('records');
    const result = fetchMissouriValleyPage();
    await jest.runAllTimersAsync();
    await expect(result).resolves.toBe('records');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails after three transient failures, preserving the error', async () => {
    const error = socketFailure('ECONNRESET');
    fetchMock.mockRejectedValue(error);
    const result = expect(fetchMissouriValleyPage()).rejects.toMatchObject({
      message: expect.stringContaining('failed after 3 attempt(s): fetch failed (ECONNRESET: ECONNRESET)'),
      cause: error,
    });
    await jest.runAllTimersAsync();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    socketFailure('CERT_HAS_EXPIRED'),
    socketFailure('ERR_TLS_CERT_ALTNAME_INVALID'),
    new Error('GET records failed with 404'),
    new TypeError('unexpected error'),
  ])('does not retry permanent or unclassified failures: %s', async (error) => {
    fetchMock.mockRejectedValue(error);
    await expect(fetchMissouriValleyPage()).rejects.toMatchObject({ cause: error });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
