import { fetchPdf, fetchText, HttpStatusError } from '../../convex/scrapers/lib/http';
import { WSO_SOURCES } from '../../convex/scrapers/wsoRecords';

// The WSOs read from their own sites, with the fetches and parsers stubbed:
// these tests are about which requests are tried again, not about layouts.
jest.mock('../../convex/scrapers/lib/http', () => ({
  ...jest.requireActual('../../convex/scrapers/lib/http'),
  fetchText: jest.fn(),
  fetchPdf: jest.fn(),
}));
jest.mock('../../convex/scrapers/lib/pdf', () => ({
  pdfLines: jest.fn(async () => [['line']]),
  pdfRunLines: jest.fn(async () => [[{ text: 'line', runs: [] }]]),
}));
const record = (wso: string) => ({ wso, age_category: 'Senior', gender: 'Men', weight_class: '65', snatch_record: 100, cj_record: 120, total_record: 220 });
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
  newEnglandPdfUrls: () => ['https://www.newenglandweightlifting.com/a.pdf'],
  parseNewEngland: (_: unknown, wso: string) => [record(wso)],
}));
jest.mock('../../convex/scrapers/parse/wso/missouriValley', () => ({
  ...jest.requireActual('../../convex/scrapers/parse/wso/missouriValley'),
  missouriValleyLines: () => ['line'],
  parseMissouriValley: () => [record('Missouri Valley')],
}));

const textMock = jest.mocked(fetchText);
const pdfMock = jest.mocked(fetchPdf);
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
  ['New England', 'https://www.newenglandweightlifting.com/records', 1],
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

  it('keeps the 60-second PDF timeout for Mountain South, New York and New England', async () => {
    for (const wso of ['Mountain South', 'New York', 'New England']) await scrape(wso);
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
