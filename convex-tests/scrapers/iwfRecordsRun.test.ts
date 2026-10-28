import { keepStoredHolders, run } from '../../convex/scrapers/iwfRecords';
import { isQuotaRefusal, UNBLOCK_URL } from '../../convex/scrapers/lib/browserless';
import { describeFailure } from '../../convex/lib/cronAlerts';
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

const runMutation = jest.fn(async (_ref: unknown, _args: { rows: unknown[] }) => ({ inserted: 0, updated: 0, deleted: 0, unchanged: 3, changes: [] }));
const runQuery = jest.fn(async (): Promise<unknown[]> => []);

/** The run, its retry waits passed on fake timers. */
async function runJob(args: Args = {}): Promise<Result> {
  const outcome = handlerOf<Args, Result>(run)({ runMutation, runQuery }, args);
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
    runQuery.mockReset().mockResolvedValue([]);
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

    it('skips without writing when a later page stays down after the first was read', async () => {
      const fetchMock = serve({ wiki: wikipedia([json({ parse: { wikitext: 'wiki' } })], json({}, 502)) });
      expect((await runJob()).source).toBe('skipped');
      expect(calls(fetchMock, 'wikipedia')).toHaveLength(5);
      expect(runMutation).not.toHaveBeenCalled();
    });

    it('writes Wikipedia\'s holders as they are when it is the only source', async () => {
      serve();
      await runJob();
      expect(runQuery).not.toHaveBeenCalled();
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

    it('falls back when Browserless answers without the page, or IWF\'s pages take too long', async () => {
      serve({ iwf: json({ content: null }) });
      expect((await runJob()).source).toBe('wikipedia');
      const slow = serve({
        iwf: () => {
          jest.setSystemTime(Date.now() + 3 * 60_000);
          return json({ content: 'iwf page' })();
        },
      });
      expect((await runJob()).source).toBe('wikipedia');
      // Two pages, then no time left for a third.
      expect(calls(slow, 'browserless')).toHaveLength(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('iwf.sport took over 5 minutes'));
    });

    it('keeps the stored holders on a fallback day, so the records are not rewritten', async () => {
      const iwfHolder = { name: 'RI Song Gum', date: '2026-09-23', location: 'Aichi-Nagoya' };
      runQuery.mockResolvedValue([{ ageCategory: 'Senior', gender: 'Men', weightClass: '60kg', snatchRecord: 1, cjRecord: 2, totalRecord: 3, snatchBy: iwfHolder }]);
      serve({ iwf: json({}, 503) });
      expect((await runJob()).source).toBe('wikipedia');
      const rows = runMutation.mock.calls[0][1].rows as { ageCategory: string; snatchBy?: unknown }[];
      expect(rows.find((r) => r.ageCategory === 'Senior')?.snatchBy).toEqual(iwfHolder);
    });

    it('falls back to Wikipedia without a warning when Browserless is out of units or busy', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        const text = (body: string, status: number) => () => new Response(body, { status });
        // A 429 is tried again (the plan's browsers may only be busy); 402 and a plan 403 are not.
        for (const [answer, tries] of [
          [text('Too Many Requests', 429), 2],
          [text('Payment required', 402), 1],
          [text('Your monthly units are exhausted. Upgrade your plan to continue.', 403), 1],
        ] as const) {
          const fetchMock = serve({ iwf: answer });
          const result = await runJob();
          expect(result.source).toBe('wikipedia');
          expect(calls(fetchMock, 'browserless')).toHaveLength(tries);
        }
        expect(warn).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Browserless plan limit, using Wikipedia'));
        expect(runMutation).toHaveBeenCalledTimes(3);
      } finally {
        log.mockRestore();
      }
    });

    it('stores Wikipedia, then fails so Sentry and the cron alert report it, when Browserless refuses the key', async () => {
      for (const status of [401, 403]) {
        runMutation.mockClear();
        const fetchMock = serve({ iwf: () => new Response('Invalid API key. Please check your API key and try again. (requestId: 1)', { status }) });
        const failure = await runJob().catch((error: unknown) => error);
        // Wikipedia's records were stored before the run failed.
        expect(runMutation).toHaveBeenCalledTimes(1);
        // A refused key is not tried again.
        expect(calls(fetchMock, 'browserless')).toHaveLength(1);
        const described = describeFailure(failure);
        expect(described.failedSources).toEqual(['browserless']);
        expect(described.error).toContain(`Browserless refused the token (${status})`);
        expect(described.error).not.toContain(TOKEN);
      }
    });

    it('still reports a refused key when Wikipedia is skipped, and names Wikipedia too when it fails', async () => {
      const refused = () => new Response('Invalid API key.', { status: 401 });
      serve({ iwf: refused, wiki: wikipedia([], json({}, 503)) });
      expect(describeFailure(await runJob().catch((error: unknown) => error)).failedSources).toEqual(['browserless']);
      serve({ iwf: refused, wiki: wikipedia([], json({}, 404)) });
      const failure = describeFailure(await runJob().catch((error: unknown) => error));
      expect(failure.failedSources).toEqual(['browserless', 'wikipedia']);
      expect(failure.error).toContain('failed with 404');
      expect(runMutation).not.toHaveBeenCalled();
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

describe('keepStoredHolders', () => {
  const stored = { name: 'RI Song Gum', date: '2026-09-23', location: 'Aichi-Nagoya' };
  const fresh = { name: 'Ri Song-gum', date: '2026-09-23', location: 'Asian Games, Nagoya, Japan' };
  const record = { ageCategory: 'Senior' as const, gender: 'Women' as const, weightClass: '49kg', snatchRecord: 94, cjRecord: 121, totalRecord: 216, snatchBy: fresh, cjBy: fresh, totalBy: fresh };

  it('keeps the stored holder of an unchanged lift and takes the new one where the record moved', () => {
    const [kept] = keepStoredHolders([record], [{ ageCategory: 'Senior', gender: 'Women', weightClass: '49kg', snatchRecord: 94, cjRecord: 121, totalRecord: 215, snatchBy: stored, totalBy: stored }]);
    expect(kept).toMatchObject({ snatchBy: stored, totalBy: fresh, totalRecord: 216 });
    // No stored holder to keep.
    expect(kept.cjBy).toEqual(fresh);
  });

  it('leaves a class it has no stored record of, or another class, alone', () => {
    expect(keepStoredHolders([record], [])).toEqual([record]);
    expect(keepStoredHolders([record], [{ ageCategory: 'Junior', gender: 'Women', weightClass: '49kg', snatchRecord: 94, snatchBy: stored }])).toEqual([record]);
  });
});

describe('isQuotaRefusal', () => {
  it('takes 402, 429 and a plan refusal for the plan, and an invalid key or an outage for neither', () => {
    expect(isQuotaRefusal(402, '')).toBe(true);
    expect(isQuotaRefusal(429, 'Too Many Requests')).toBe(true);
    expect(isQuotaRefusal(403, 'Usage limit exceeded for this billing period')).toBe(true);
    expect(isQuotaRefusal(401, 'Invalid API key. Please check your API key and try again. (requestId: bb59)')).toBe(false);
    expect(isQuotaRefusal(403, 'Forbidden')).toBe(false);
    expect(isQuotaRefusal(500, 'quota service down')).toBe(false);
  });
});
