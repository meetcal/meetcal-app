import { fetchJson, fetchPdf, fetchText, HttpStatusError, mapLimited, throttledOrTransient, USER_AGENT, withRetries } from '../../convex/scrapers/lib/http';
import { pyFloat, pyInt } from '../../convex/scrapers/lib/numbers';
import { setHolder, type RecordHolder } from '../../convex/scrapers/parse/holder';
import { blankRecord, columnDLift, liftsRecord, NO_LIFT, plusLast, setLift } from '../../convex/scrapers/parse/wso/common';

describe('shared scraper helpers', () => {
  it("reads numbers as Python's float() and int(float()) do", () => {
    expect(pyFloat(' 102.5 ')).toBe(102.5);
    expect(pyFloat('1e3')).toBe(1000);
    expect(pyFloat('.5')).toBe(0.5);
    for (const text of ['', '1,000', 'NaN', 'inf', '12kg', '-']) expect(pyFloat(text)).toBeNull();
    expect(pyInt('102.9')).toBe(102);
    expect(pyInt('-3.5')).toBe(-3);
    expect(pyInt('1e999')).toBeNull();
    expect(pyInt('STANDARD')).toBeNull();
  });

  it('sets or clears a holder', () => {
    const holder: RecordHolder = { name: 'Ann' };
    const record: { snatch_by?: RecordHolder } = {};
    setHolder(record, 'snatch_by', holder);
    expect(record).toEqual({ snatch_by: holder });
    setHolder(record, 'snatch_by', undefined);
    expect('snatch_by' in record).toBe(false);
  });

  it('builds WSO records the same way for every source', () => {
    expect(plusLast('+87')).toBe('87+');
    expect(plusLast('87+')).toBe('87+');
    expect(plusLast('61')).toBe('61');
    const record = blankRecord('Ohio', 'U15', 'Women');
    setLift(record, 'cj', 80, { name: 'Ann' });
    expect(record).toEqual({ wso: 'Ohio', age_category: 'U15', gender: 'Women', weight_class: '', snatch_record: null, cj_record: 80, total_record: null, cj_by: { name: 'Ann' } });
    setLift(record, 'cj', null, undefined);
    expect(record).not.toHaveProperty('cj_by');
    const snatch = columnDLift(['Snatch', 'Ann Lee', 'Team', '61', '2026-03-01', 'Ohio Open', 'Columbus']);
    expect(snatch).toEqual({ value: 61, by: { name: 'Ann Lee', date: '2026-03-01', location: 'Ohio Open, Columbus' } });
    expect(columnDLift(['Total', 'STANDARD', '', 'STANDARD'])).toEqual({ value: null, by: undefined });
    expect(columnDLift(['Total'])).toEqual({ value: null, by: undefined });
    expect(liftsRecord('Ohio', 'U15', 'Women', '48', { snatch, cj: NO_LIFT, total: { value: 0 } })).toEqual({
      wso: 'Ohio', age_category: 'U15', gender: 'Women', weight_class: '48', snatch_record: 61, cj_record: null, total_record: 0, snatch_by: snatch.by,
    });
  });

  describe('fetching', () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
      jest.useRealTimers();
    });

    it('asks for JSON with the default headers, which the caller can replace, and checks the status', async () => {
      const fetchMock = jest.fn(async () => new Response('{"a":1}', { status: 200 }));
      global.fetch = fetchMock as typeof fetch;
      expect(await fetchJson('https://example.test/a', { headers: { 'User-Agent': 'MeetCal' } })).toEqual({ a: 1 });
      expect(fetchMock).toHaveBeenCalledWith('https://example.test/a', expect.objectContaining({ headers: { 'User-Agent': 'MeetCal', accept: 'application/json' } }));
      global.fetch = jest.fn(async () => new Response('down', { status: 503 })) as typeof fetch;
      await expect(fetchJson('https://example.test/b')).rejects.toThrow('GET https://example.test/b failed with 503');
    });

    it('asks for a PDF with a browser User-Agent, refusing a refusal page and a body that is not a PDF', async () => {
      const pdf = new TextEncoder().encode('%PDF-1.7 rest');
      const fetchMock = jest.fn(async () => new Response(pdf, { status: 200 }));
      global.fetch = fetchMock as typeof fetch;
      expect(await fetchPdf('https://example.test/records.pdf')).toEqual(pdf);
      expect(fetchMock).toHaveBeenCalledWith('https://example.test/records.pdf', expect.objectContaining({ headers: { 'User-Agent': USER_AGENT, accept: 'application/pdf' } }));
      // mountainsouth.org answers a request without a browser User-Agent with a 406 page.
      global.fetch = jest.fn(async () => new Response('<html>Not Acceptable</html>', { status: 406 })) as typeof fetch;
      await expect(fetchPdf('https://example.test/records.pdf')).rejects.toThrow('GET https://example.test/records.pdf failed with 406');
      global.fetch = jest.fn(async () => new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
      await expect(fetchPdf('https://example.test/records.pdf')).rejects.toThrow('GET https://example.test/records.pdf returned text/html, not a PDF (20 bytes)');
    });

    it('retries as the policy says, then gives up with the last failure', async () => {
      jest.useFakeTimers();
      const run = jest.fn().mockRejectedValueOnce(new Error('one')).mockResolvedValueOnce('ok');
      const ok = withRetries(run, { attempts: 3, delayMs: (attempt) => attempt * 1000 });
      await jest.advanceTimersByTimeAsync(1000);
      await expect(ok).resolves.toBe('ok');
      expect(run).toHaveBeenCalledTimes(2);

      const failing = jest.fn().mockRejectedValue(new Error('always'));
      const failed = expect(withRetries(failing, { attempts: 3, delayMs: () => 10 }, (error, attempts) => new Error(`${(error as Error).message} x${attempts}`))).rejects.toThrow('always x3');
      await jest.runAllTimersAsync();
      await failed;

      const permanent = jest.fn().mockRejectedValue(new Error('404'));
      await expect(withRetries(permanent, { attempts: 3, delayMs: () => 10, retryIf: () => false })).rejects.toThrow('404');
      expect(permanent).toHaveBeenCalledTimes(1);
    });

    it('retries a throttled (429) or server-failed (5xx) request, not a missing page', async () => {
      global.fetch = jest.fn(async () => new Response('slow down', { status: 429 })) as typeof fetch;
      const throttled = await fetchText('https://example.test/tab').catch((error: unknown) => error);
      expect(throttled).toBeInstanceOf(HttpStatusError);
      expect(throttled).toMatchObject({ status: 429, message: 'GET https://example.test/tab failed with 429' });
      expect(throttledOrTransient(throttled)).toBe(true);
      expect(throttledOrTransient(new HttpStatusError('u', 503))).toBe(true);
      expect(throttledOrTransient(new HttpStatusError('u', 404))).toBe(false);
      expect(throttledOrTransient(new Error('parse failed'))).toBe(false);
      expect(throttledOrTransient(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(true);
    });

    it('runs at most `limit` calls at once, answering in order', async () => {
      let running = 0;
      let most = 0;
      const answers = await mapLimited([5, 1, 4, 2, 3, 0], 2, async (ms) => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, ms));
        running -= 1;
        return ms * 10;
      });
      expect(answers).toEqual([50, 10, 40, 20, 30, 0]);
      expect(most).toBe(2);
      expect(await mapLimited([], 4, async () => 1)).toEqual([]);
      await expect(mapLimited([1], 0, async () => 1)).rejects.toThrow('limit must be at least 1');
    });

    it('starts no new call after one fails, and rejects with that failure', async () => {
      const started: number[] = [];
      const run = mapLimited([1, 2, 3, 4, 5], 2, async (n) => {
        started.push(n);
        if (n === 2) throw new Error('tab 2 failed');
        await new Promise((resolve) => setTimeout(resolve, 5));
        return n;
      });
      await expect(run).rejects.toThrow('tab 2 failed');
      expect(started).toEqual([1, 2]);
    });
  });
});
