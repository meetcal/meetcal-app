import { getFunctionName } from 'convex/server';
import { JOBS, run } from '../convex/cronJobs';
import { chainOutcome, describeFailure, MAX_CONTINUATIONS, nextLink, sourcesFailed } from '../convex/lib/cronAlerts';
import { NOT_REACHED } from '../convex/scrapers/lib/budget';
import { handlerOf } from './fakeDb';

const failed = (failures: Parameters<typeof sourcesFailed>[1]) => describeFailure(sourcesFailed('wso records', failures));
const unreached = (source: string) => ({ source, error: NOT_REACHED, notReached: true });

describe('continuing a run for the sources it did not reach (#622)', () => {
  it('continues with the unreached sources, carrying the real failures', () => {
    const outcome = failed([{ source: 'Ohio', error: 'boom' }, unreached('Texas'), unreached('Utah')]);
    expect(nextLink(outcome, undefined, 0)).toEqual({ notReached: ['Texas', 'Utah'], failed: [{ source: 'Ohio', error: 'boom' }] });
  });

  it('stops when nothing was left unreached, when a continuation reached nothing, or after the last continuation', () => {
    expect(nextLink(undefined, undefined, 0)).toBeNull();
    expect(nextLink(failed([{ source: 'Ohio', error: 'boom' }]), undefined, 0)).toBeNull();
    expect(nextLink(describeFailure(new Error('whole job failed')), undefined, 0)).toBeNull();
    const stuck = failed([unreached('Texas'), unreached('Utah')]);
    expect(nextLink(stuck, ['Texas', 'Utah'], 1)).toBeNull();
    expect(nextLink(failed([unreached('Utah')]), ['Texas', 'Utah'], 1)).not.toBeNull();
    expect(nextLink(failed([unreached('Utah')]), ['Texas', 'Utah'], MAX_CONTINUATIONS)).toBeNull();
  });

  it('records one outcome for the chain: every failure carried and the last run’s own', () => {
    const carried = [{ source: 'Ohio', error: 'boom' }];
    expect(chainOutcome('wso-records', [], undefined)).toBeUndefined();
    expect(chainOutcome('wso-records', carried, undefined)).toMatchObject({ failedSources: ['Ohio'], error: expect.stringContaining('Ohio: boom') });
    const last = chainOutcome('wso-records', carried, failed([{ source: 'Utah', error: 'slow' }]));
    expect(last).toMatchObject({ failedSources: ['Ohio', 'Utah'] });
    expect(last?.error).toContain('Ohio: boom');
    expect(last?.error).toContain('Utah: slow');
    const whole = chainOutcome('wso-records', carried, describeFailure(new Error('Google refused')), ['Texas']);
    expect(whole).toMatchObject({ failedSources: ['Ohio', 'Texas'] });
    expect(whole?.error).toContain('Google refused');
    expect(whole?.error).toContain('Ohio: boom');
    expect(whole?.error).toContain('Texas: not reached: Google refused');
    expect(chainOutcome('wso-records', [], describeFailure(new Error('Google refused')), ['Texas'])).toMatchObject({ failedSources: ['Texas'] });
    expect(chainOutcome('wso-records', [], describeFailure(new Error('Google refused')))).toEqual({ error: 'Google refused' });
  });
});

describe('the arguments a continuation sends', () => {
  it("hands Sport80 its unreached sources by name, and asks the other jobs for them with only", () => {
    const continueWith = (job: string) => {
      const spec = JOBS[job]?.run;
      return spec?.kind === 'sources' ? spec.continueWith : undefined;
    };
    expect(continueWith('results-sport80')?.(['Meet 1 (event 101)', 'event 102'])).toEqual({ continuing: ['Meet 1 (event 101)', 'event 102'] });
    expect(continueWith('wso-records')?.(['Ohio'])).toEqual({ only: ['Ohio'] });
    expect(continueWith('entries')?.(['Meet A'])).toEqual({ only: ['Meet A'] });
    expect(continueWith('urlwatch')).toBeUndefined();
  });
});

describe("cronJobs:run for a job that reads many sources (#622)", () => {
  function deployment(answer: (only: string[] | undefined) => Promise<unknown>) {
    const scheduled: Record<string, unknown>[] = [];
    const finished: Record<string, unknown>[] = [];
    const asked: (string[] | undefined)[] = [];
    const ctx = {
      runMutation: jest.fn(async (fn: unknown, args: Record<string, unknown>) => {
        const name = getFunctionName(fn as never);
        if (name === 'cronStatus:finish') {
          finished.push(args);
          return [];
        }
        return name === 'cronStatus:raiseAlert' ? null : undefined;
      }),
      runQuery: jest.fn(async () => []),
      runAction: jest.fn(async (_fn: unknown, args: { only?: string[] }) => {
        asked.push(args.only);
        return answer(args.only);
      }),
      scheduler: { runAfter: jest.fn(async (_ms: number, _fn: unknown, args: Record<string, unknown>) => void scheduled.push(args)) },
    };
    const call = (args: Record<string, unknown>) => handlerOf<Record<string, unknown>, unknown>(run)(ctx, { job: 'wso-records', ...args });
    return { call, scheduled, finished, asked };
  }

  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('schedules a continuation for the sources it did not reach, and records nothing yet', async () => {
    const { call, scheduled, finished } = deployment(async () => {
      throw sourcesFailed('wso records', [{ source: 'Ohio', error: 'boom' }, unreached('Texas')]);
    });
    await call({});
    expect(scheduled).toEqual([{ job: 'wso-records', pending: ['Texas'], carried: [{ source: 'Ohio', error: 'boom' }], continuations: 1 }]);
    expect(finished).toEqual([]);
  });

  it('records the whole chain once the continuation reaches its sources', async () => {
    const { call, scheduled, finished, asked } = deployment(async () => []);
    await expect(call({ pending: ['Texas'], carried: [{ source: 'Ohio', error: 'boom' }], continuations: 1 })).rejects.toThrow('Ohio: boom');
    expect(asked).toEqual([['Texas']]);
    expect(scheduled).toEqual([]);
    expect(finished).toEqual([{ job: 'wso-records', error: expect.stringContaining('Ohio: boom'), failedSources: ['Ohio'] }]);
  });

  it('names the sources a continuation was sent to reach when it fails as a whole', async () => {
    const { call, finished } = deployment(async () => {
      throw new Error('Google refused');
    });
    await expect(call({ pending: ['Texas'], carried: [{ source: 'Ohio', error: 'boom' }], continuations: 1 })).rejects.toThrow('Google refused');
    expect(finished).toEqual([{ job: 'wso-records', error: expect.stringContaining('Texas: not reached: Google refused'), failedSources: ['Ohio', 'Texas'] }]);
  });

  it('records a clean chain as a success', async () => {
    const { call, finished } = deployment(async () => []);
    await call({ pending: ['Texas'], carried: [], continuations: 1 });
    expect(finished).toEqual([{ job: 'wso-records', error: undefined, failedSources: undefined }]);
  });

  it('stops and names the sources still unreached when a continuation reached none of them', async () => {
    const { call, scheduled, finished } = deployment(async () => {
      throw sourcesFailed('wso records', [unreached('Texas')]);
    });
    await expect(call({ pending: ['Texas'], carried: [], continuations: 1 })).rejects.toThrow(NOT_REACHED);
    expect(scheduled).toEqual([]);
    expect(finished).toEqual([{ job: 'wso-records', error: expect.stringContaining(`Texas: ${NOT_REACHED}`), failedSources: ['Texas'] }]);
  });
});
