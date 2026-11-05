import { fetchPdf, fetchText, HttpStatusError } from '../../convex/scrapers/lib/http';
import { fetchPdfRetrying, fetchTextRetrying, TRANSIENT_RETRY } from '../../convex/scrapers/lib/transientFetch';

jest.mock('../../convex/scrapers/lib/http', () => ({
  ...jest.requireActual('../../convex/scrapers/lib/http'),
  fetchText: jest.fn(),
  fetchPdf: jest.fn(),
}));
const textMock = jest.mocked(fetchText);
const pdfMock = jest.mocked(fetchPdf);
const socketFailure = (code: string) => new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

// Each helper, its mock, and what a successful fetch answers.
const helpers = [
  { name: 'fetchTextRetrying', run: fetchTextRetrying, mock: textMock as jest.Mock, ok: '<h2>Records</h2>' },
  { name: 'fetchPdfRetrying', run: fetchPdfRetrying, mock: pdfMock as jest.Mock, ok: PDF },
] as const;

describe.each(helpers)('$name transient failures', ({ run, mock, ok }) => {
  const url = 'https://example.org/records';
  beforeEach(() => {
    textMock.mockReset();
    pdfMock.mockReset();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('recovers after a connection reset and a connect timeout, 1 and then 2 seconds apart', async () => {
    mock.mockRejectedValueOnce(socketFailure('ECONNRESET'))
      .mockRejectedValueOnce(socketFailure('UND_ERR_CONNECT_TIMEOUT'))
      .mockResolvedValueOnce(ok);
    const result = run(url, 60_000);
    await jest.advanceTimersByTimeAsync(999);
    expect(mock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(mock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1_999);
    expect(mock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(ok);
    expect(mock).toHaveBeenCalledTimes(3);
    expect(mock).toHaveBeenLastCalledWith(url, 60_000);
  });

  it('retries a request timeout', async () => {
    mock.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(ok);
    const result = run(url);
    await jest.runAllTimersAsync();
    await expect(result).resolves.toEqual(ok);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('fails after three transient failures, naming the URL and keeping the error', async () => {
    const error = socketFailure('ECONNRESET');
    mock.mockRejectedValue(error);
    const result = expect(run(url)).rejects.toMatchObject({
      message: `GET ${url} failed after 3 attempt(s): fetch failed (ECONNRESET: ECONNRESET)`,
      cause: error,
    });
    await jest.runAllTimersAsync();
    await result;
    expect(mock).toHaveBeenCalledTimes(TRANSIENT_RETRY.attempts);
  });

  it.each([
    ['a 404', new HttpStatusError('https://example.org/records', 404)],
    ['a 500', new HttpStatusError('https://example.org/records', 500)],
    ['an expired certificate', socketFailure('CERT_HAS_EXPIRED')],
    ['a certificate for another host', socketFailure('ERR_TLS_CERT_ALTNAME_INVALID')],
    ['a body that is not a PDF', new Error('GET https://example.org/records returned text/html, not a PDF (512 bytes)')],
    ['an unclassified fetch error', new TypeError('unexpected error')],
  ])('does not retry %s', async (_, error) => {
    mock.mockRejectedValue(error);
    await expect(run(url)).rejects.toMatchObject({ message: expect.stringContaining('failed after 1 attempt(s)'), cause: error });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
