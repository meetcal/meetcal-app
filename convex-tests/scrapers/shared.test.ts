import { fetchJson, withRetries } from '../../convex/scrapers/lib/http';
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
  });
});
