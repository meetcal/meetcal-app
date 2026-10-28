import { run } from '../../convex/scrapers/iwfRecords';
import { UNBLOCK_URL } from '../../convex/scrapers/lib/browserless';
import { handlerOf } from '../fakeDb';

// The parsers have their own tests; here each page's text names the record it stands for.
jest.mock('../../convex/scrapers/parse/iwfRecords', () => ({
  ...jest.requireActual('../../convex/scrapers/parse/iwfRecords'),
  parseIwfWikitext: (text: string, ageCategory: string) => [{ ageCategory, gender: 'Men', weightClass: '60kg', snatchRecord: 1, cjRecord: 2, totalRecord: 3, from: text }],
}));
jest.mock('../../convex/scrapers/parse/iwfSite', () => ({
  ...jest.requireActual('../../convex/scrapers/parse/iwfSite'),
  parseIwfSiteHtml: (html: string, ageCategory: string, gender: string) => [{ ageCategory, gender, weightClass: '60kg', snatchRecord: 1, cjRecord: 2, totalRecord: 3, from: html }],
}));

type Args = { dryRun?: boolean };
type Result = { source: string; records: { from: string }[] };
type Answer = () => Response;

const TOKEN = 'browserless-test-token';
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const wikipedia = (answers: Answer[], last: Answer = json({ parse: { wikitext: 'wiki' } })) => ({ answers, last });

/** Answers Wikipedia with `wiki`'s answers in turn (its `last` after them), Browserless with `iwf`'s. */
function serve({ wiki = wikipedia([]), iwf = json({ content: 'iwf page' }) }: { wiki?: { answers: Answer[]; last: Answer }; iwf?: Answer } = {}) {
  const fetchMock = jest.fn(async (url: string, _init?: RequestInit) => (url === UNBLOCK_URL ? iwf() : (wiki.answers.shift() ?? wiki.last)()));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof serve>, host: 'wikipedia' | 'browserless') =>
  fetchMock.mock.calls.filter(([url]) => (host === 'browserless' ? url === UNBLOCK_URL : url.includes('wikipedia.org')));

const runMutation = jest.fn(async () => ({ inserted: 0, updated: 0, deleted: 0, unchanged: 3, changes: [] }));

/** The run, its retry waits passed on fake timers. */
async function runJob(args: Args = {}): Promise<Result> {
  const outcome = handlerOf<Args, Result>(run)({ runMutation }, args);
  outcome.catch(() => undefined);
  await jest.runAllTimersAsync();
  return outcome;
}

describe('iwf-world-records run', () => {
  const realFetch = global.fetch;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    runMutation.mockClear();
    delete process.env.BROWSERLESS_TOKEN;
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
    warn.mockRestore();
    delete process.env.BROWSERLESS_TOKEN;
  });

  describe('from Wikipedia', () => {
    it('identifies itself and retries a 503 or a 429 until Wikipedia answers', async () => {
      const fetchMock = serve({ wiki: wikipedia([json({}, 503), json({}, 429)]) });
      const result = await runJob();
      expect(result.source).toBe('wikipedia');
      expect(result.records).toHaveLength(3);
      // Two failures and three pages read.
      expect(calls(fetchMock, 'wikipedia')).toHaveLength(5);
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['User-Agent']).toMatch(/^MeetCal\/\d+\.\d+ \(https:\/\/meetcal\.app; .+\) iwf-world-records$/);
      expect(runMutation).toHaveBeenCalledTimes(1);
      expect(calls(fetchMock, 'browserless')).toHaveLength(0);
    });

    it('skips the run with a warning, keeping the stored records, when Wikipedia stays down', async () => {
      const fetchMock = serve({ wiki: wikipedia([], json({}, 503)) });
      const result = await runJob();
      expect(result).toEqual({ source: 'skipped', records: [], inserted: 0, updated: 0, deleted: 0, unchanged: 0, changes: [] });
      // The first page, tried four times; the others are not asked.
      expect(calls(fetchMock, 'wikipedia')).toHaveLength(4);
      expect(runMutation).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Wikipedia unavailable, run skipped and stored records kept'));
    });

    it('still fails on an answer that is not a passing outage, so it alerts', async () => {
      serve({ wiki: wikipedia([], json({}, 404)) });
      await expect(runJob()).rejects.toThrow('failed with 404');
      serve({ wiki: wikipedia([], json({ error: { info: "The page you specified doesn't exist." } })) });
      await expect(runJob()).rejects.toThrow("doesn't exist");
      expect(runMutation).not.toHaveBeenCalled();
    });
  });

  describe('from iwf.sport through Browserless', () => {
    beforeEach(() => {
      process.env.BROWSERLESS_TOKEN = TOKEN;
    });

    it('reads all six pages and does not ask Wikipedia', async () => {
      const fetchMock = serve();
      const result = await runJob();
      expect(result.source).toBe('iwf.sport');
      expect(result.records).toHaveLength(6);
      expect(calls(fetchMock, 'wikipedia')).toHaveLength(0);
      const [url, init] = calls(fetchMock, 'browserless')[0];
      // The token goes in the header, never the URL, which errors repeat.
      expect(url).not.toContain(TOKEN);
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
      expect(JSON.parse(String(init?.body))).toMatchObject({ url: expect.stringContaining('ranking_agegroup=Senior&ranking_gender=m'), content: true });
      expect(runMutation).toHaveBeenCalledTimes(1);
    });

    it('falls back to Wikipedia whole, with a warning, when iwf.sport stays behind its challenge', async () => {
      const fetchMock = serve({ iwf: json({ content: '<html><head><title>Just a moment...</title></head></html>' }) });
      const result = await runJob();
      expect(result.source).toBe('wikipedia');
      expect(result.records.every((r) => r.from === 'wiki')).toBe(true);
      // The first page, tried twice, then no more of IWF's.
      expect(calls(fetchMock, 'browserless')).toHaveLength(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('iwf.sport failed, using Wikipedia'));
      expect(warn.mock.calls.flat().join(' ')).not.toContain(TOKEN);
    });

    it('falls back on a Browserless error, and skips when Wikipedia is down too', async () => {
      const fetchMock = serve({ iwf: json({}, 500), wiki: wikipedia([], json({}, 503)) });
      const result = await runJob();
      expect(result.source).toBe('skipped');
      expect(calls(fetchMock, 'browserless')).toHaveLength(2);
      expect(runMutation).not.toHaveBeenCalled();
    });

    it('stores nothing on a dry run', async () => {
      serve();
      const result = await runJob({ dryRun: true });
      expect(result.source).toBe('iwf.sport');
      expect(runMutation).not.toHaveBeenCalled();
    });
  });
});
