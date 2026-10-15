import { MAINTAINED_WSOS } from '../../convex/lib/wsoSources';
import { fetchSheetText, SHEET_RETRY, WSO_SOURCES } from '../../convex/scrapers/wsoRecords';

describe('maintained WSOs', () => {
  // The WSO records answers offer only these, so a WSO with a source must be listed, and none without.
  it('lists exactly the WSOs the wso-records job scrapes', () => {
    expect([...MAINTAINED_WSOS].sort()).toEqual(WSO_SOURCES.map((source) => source.wso).sort());
    expect(new Set(MAINTAINED_WSOS).size).toBe(MAINTAINED_WSOS.length);
  });
});

describe('Google Sheets requests', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  // Google throttled Tennessee-Kentucky's tabs, fetched at once, with 429 (October 2026).
  it('tries a throttled tab again after 2, 4 and 8 seconds', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('a,b', { status: 200 }));
    global.fetch = fetchMock as typeof fetch;
    const text = fetchSheetText('https://docs.google.com/x');
    await jest.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(4000);
    await expect(text).resolves.toBe('a,b');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect([1, 2, 3].map(SHEET_RETRY.delayMs)).toEqual([2000, 4000, 8000]);
  });

  it('gives up after four tries, and does not retry a missing tab', async () => {
    jest.useFakeTimers();
    const throttled = jest.fn(async () => new Response('', { status: 429 }));
    global.fetch = throttled as typeof fetch;
    const failed = expect(fetchSheetText('https://docs.google.com/x')).rejects.toThrow('failed with 429');
    await jest.runAllTimersAsync();
    await failed;
    expect(throttled).toHaveBeenCalledTimes(4);

    const missing = jest.fn(async () => new Response('', { status: 404 }));
    global.fetch = missing as typeof fetch;
    await expect(fetchSheetText('https://docs.google.com/y')).rejects.toThrow('failed with 404');
    expect(missing).toHaveBeenCalledTimes(1);
  });
});
