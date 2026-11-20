import { fetchJson, fetchPdf, fetchText, HttpStatusError, postJson } from '../../convex/scrapers/lib/http';
import { WSO_SOURCES } from '../../convex/scrapers/wsoRecords';

// The WSOs read from their own sites, with the fetches and parsers stubbed:
// these tests are about which requests are tried again, not about layouts.
jest.mock('../../convex/scrapers/lib/http', () => ({
  ...jest.requireActual('../../convex/scrapers/lib/http'),
  fetchText: jest.fn(),
  fetchPdf: jest.fn(),
  fetchJson: jest.fn(),
  postJson: jest.fn(),
}));
jest.mock('../../convex/scrapers/lib/pdf', () => ({
  pdfLines: jest.fn(async () => [['line']]),
  pdfRunLines: jest.fn(async () => [[{ text: 'line', runs: [] }]]),
}));
const record = (wso: string) => ({ wso, ageCategory: 'Senior', gender: 'Men', weightClass: '65', snatchRecord: 100, cjRecord: 120, totalRecord: 220 });
jest.mock('../../convex/scrapers/parse/wso/illinois', () => ({
  illinoisPdfHref: () => '/records.pdf',
  parseIllinois: (_: unknown, wso: string) => ({ records: [record(wso)], warnings: [] }),
}));
jest.mock('../../convex/scrapers/parse/wso/mountainSouth', () => ({
  mountainSouthPdfUrls: () => ['https://mountainsouth.org/a.pdf', 'https://mountainsouth.org/b.pdf'],
  parseMountainSouth: (_: unknown, wso: string) => [record(wso)],
}));
jest.mock('../../convex/scrapers/parse/wso/newYork', () => ({
  newYorkPdfUrls: () => ['https://www.nywso.com/a.pdf'],
  parseNewYork: (_: unknown, wso: string) => [record(wso)],
}));
jest.mock('../../convex/scrapers/parse/wso/newEngland', () => ({
  ...jest.requireActual('../../convex/scrapers/parse/wso/newEngland'),
  parseNewEngland: (rows: unknown[], wso: string) => rows.map(() => record(wso)),
}));
jest.mock('../../convex/scrapers/parse/wso/missouriValley', () => ({
  ...jest.requireActual('../../convex/scrapers/parse/wso/missouriValley'),
  missouriValleyLines: () => ['line'],
  parseMissouriValley: () => [record('Missouri Valley')],
}));

const textMock = jest.mocked(fetchText);
const pdfMock = jest.mocked(fetchPdf);
const jsonMock = jest.mocked(fetchJson);
const postMock = jest.mocked(postJson);
const reset = () => new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

const source = (wso: string) => {
  const found = WSO_SOURCES.find((s) => s.wso === wso);
  if (!found) throw new Error(`no source for ${wso}`);
  return found;
};

/** A source's scrape, run with fake timers until it settles. */
async function scrape(wso: string) {
  const settled = source(wso).scrape().then((value) => ({ value }), (error: unknown) => ({ error }));
  await jest.runAllTimersAsync();
  return await settled;
}

const PAGES = [
  ['Illinois', 'https://www.illinoisweightlifting.com/', 1],
  ['Mountain South', 'https://mountainsouth.org/records/', 2],
  ['New York', 'https://www.nywso.com/state-records', 1],
] as const;

describe('WSO site sources retry transient fetch failures', () => {
  beforeEach(() => {
    textMock.mockReset().mockResolvedValue('<html></html>');
    pdfMock.mockReset().mockResolvedValue(PDF);
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it.each(PAGES)('%s: retries its records page after a connection reset and a timeout', async (wso, page, pdfs) => {
    textMock.mockRejectedValueOnce(reset()).mockRejectedValueOnce(timeout());
    const result = await scrape(wso);
    // A record per PDF, Illinois' one PDF included.
    expect(result).toEqual({ value: Array.from({ length: pdfs }, () => expect.objectContaining({ wso })) });
    expect(textMock).toHaveBeenCalledTimes(3);
    expect(textMock.mock.calls.every(([url]) => url === page)).toBe(true);
  });

  it.each(PAGES)('%s: retries each records PDF after a connection reset and a timeout', async (wso, _, pdfs) => {
    pdfMock.mockRejectedValueOnce(reset()).mockRejectedValueOnce(timeout());
    const result = await scrape(wso);
    expect(result).not.toHaveProperty('error');
    expect(pdfMock).toHaveBeenCalledTimes(pdfs + 2);
  });

  it('keeps the 60-second PDF timeout for Mountain South and New York', async () => {
    for (const wso of ['Mountain South', 'New York']) await scrape(wso);
    expect(pdfMock.mock.calls.every(([, timeoutMs]) => timeoutMs === 60_000)).toBe(true);
  });

  it('retries Missouri Valley with its 45-second timeout', async () => {
    textMock.mockRejectedValueOnce(reset());
    const result = await scrape('Missouri Valley');
    expect(result).not.toHaveProperty('error');
    expect(textMock).toHaveBeenCalledTimes(2);
    expect(textMock).toHaveBeenLastCalledWith('https://missourivalleyweightlifting.org/records/', 45_000);
  });

  it.each(PAGES)('%s: fails at once on a 404 page', async (wso, page) => {
    textMock.mockRejectedValue(new HttpStatusError(page, 404));
    const result = await scrape(wso);
    expect(result).toEqual({ error: expect.objectContaining({ message: `GET ${page} failed after 1 attempt(s): GET ${page} failed with 404` }) });
    expect(textMock).toHaveBeenCalledTimes(1);
    expect(pdfMock).not.toHaveBeenCalled();
  });

  it.each(PAGES)('%s: fails at once on a PDF with a bad certificate', async (wso, _, pdfs) => {
    const tls = new TypeError('fetch failed', { cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }) });
    pdfMock.mockRejectedValue(tls);
    const result = await scrape(wso);
    expect(result).toEqual({ error: expect.objectContaining({ message: expect.stringContaining('failed after 1 attempt(s): fetch failed (CERT_HAS_EXPIRED: certificate has expired)'), cause: tls }) });
    expect(pdfMock).toHaveBeenCalledTimes(pdfs);
  });

  it('gives up on Mountain South after three connection resets, naming the PDF', async () => {
    pdfMock.mockImplementation(async (url) => {
      if (url.endsWith('b.pdf')) throw reset();
      return PDF;
    });
    const result = await scrape('Mountain South');
    expect(result).toEqual({ error: expect.objectContaining({ message: 'GET https://mountainsouth.org/b.pdf failed after 3 attempt(s): fetch failed (ECONNRESET: read ECONNRESET)' }) });
    expect(pdfMock.mock.calls.filter(([url]) => url.endsWith('b.pdf'))).toHaveLength(3);
  });
});

describe('New England reads its records collection, retrying transient failures', () => {
  const tokensUrl = 'https://www.newenglandweightlifting.com/_api/v1/access-tokens';
  const queryUrl = 'https://www.newenglandweightlifting.com/_api/cloud-data/v2/items/query';
  const tokens = { apps: { '8f099af5-b472-4119-abfb-029f1f372d34': { accessToken: 'visitor-token' } } };
  const page = (size: number) => ({ dataItems: Array.from({ length: size }, () => ({ data: {} })) });

  beforeEach(() => {
    textMock.mockReset();
    pdfMock.mockReset();
    jsonMock.mockReset().mockResolvedValue(tokens);
    postMock.mockReset().mockResolvedValueOnce(page(200)).mockResolvedValueOnce(page(200)).mockResolvedValueOnce(page(7));
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('pages the collection with a fresh visitor token until a short page, fetching no page or PDF', async () => {
    const result = await scrape('New England');
    expect(result).toEqual({ value: expect.any(Array) });
    expect((result as { value: unknown[] }).value).toHaveLength(407);
    expect(jsonMock).toHaveBeenCalledWith(tokensUrl, undefined);
    expect(postMock.mock.calls.map(([url, body, options]) => [url, body, options])).toEqual(
      [0, 200, 400].map((offset) => [
        queryUrl,
        { dataCollectionId: 'NewEnglandWeightliftingRecords', query: { paging: { limit: 200, offset } } },
        { headers: { authorization: 'Bearer visitor-token' } },
      ]),
    );
    expect(textMock).not.toHaveBeenCalled();
    expect(pdfMock).not.toHaveBeenCalled();
  });

  it('retries the access tokens after a connection reset and a timeout', async () => {
    jsonMock.mockRejectedValueOnce(reset()).mockRejectedValueOnce(timeout());
    const result = await scrape('New England');
    expect(result).not.toHaveProperty('error');
    expect(jsonMock).toHaveBeenCalledTimes(3);
  });

  it('retries each collection page after a connection reset and a timeout', async () => {
    postMock.mockReset()
      .mockRejectedValueOnce(reset()).mockResolvedValueOnce(page(200))
      .mockRejectedValueOnce(timeout()).mockResolvedValueOnce(page(3));
    const result = await scrape('New England');
    expect((result as { value: unknown[] }).value).toHaveLength(203);
    expect(postMock).toHaveBeenCalledTimes(4);
    expect(postMock.mock.calls.map(([, body]) => (body as { query: { paging: { offset: number } } }).query.paging.offset)).toEqual([0, 0, 200, 200]);
  });

  it('fails at once when the access tokens answer 403', async () => {
    jsonMock.mockReset().mockRejectedValue(new HttpStatusError(tokensUrl, 403));
    const result = await scrape('New England');
    expect(result).toEqual({ error: expect.objectContaining({ message: `GET ${tokensUrl} failed after 1 attempt(s): GET ${tokensUrl} failed with 403` }) });
    expect(jsonMock).toHaveBeenCalledTimes(1);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('fails at once when a collection page answers 401', async () => {
    postMock.mockReset().mockRejectedValue(new HttpStatusError(queryUrl, 401, 'POST'));
    const result = await scrape('New England');
    expect(result).toEqual({ error: expect.objectContaining({ message: `POST ${queryUrl} failed after 1 attempt(s): POST ${queryUrl} failed with 401` }) });
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('fails when the CMS app has no token', async () => {
    jsonMock.mockReset().mockResolvedValue({ apps: {} });
    const result = await scrape('New England');
    expect(result).toEqual({ error: expect.objectContaining({ message: expect.stringContaining('no token for the CMS app') }) });
    expect(postMock).not.toHaveBeenCalled();
  });

  it('gives up past its page limit instead of looping forever', async () => {
    postMock.mockReset().mockResolvedValue(page(200));
    const result = await scrape('New England');
    expect(result).toEqual({ error: expect.objectContaining({ message: 'New England records run past 25 pages of 200' }) });
    expect(postMock).toHaveBeenCalledTimes(25);
  });
});
