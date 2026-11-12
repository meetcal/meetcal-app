import { SCREEN_TIMING_EVENT, SCREEN_TIMING_SAMPLE_RATE, startScreenVisit } from '@/lib/screen-timing';

function clock() {
  let now = 1000;
  let requests = 0;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    request: () => {
      requests += 1;
    },
    requestsStarted: () => requests,
  };
}

describe('screen_timing', () => {
  it('reports the first content, the data and the requests sent while waiting, once', () => {
    const time = clock();
    const send = jest.fn();
    const visit = startScreenVisit('records', { ...time, random: () => 0, send });
    time.advance(40);
    visit.content('cache');
    time.request();
    time.request();
    time.advance(600);
    visit.data();
    time.request();
    visit.data();
    visit.finish();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(SCREEN_TIMING_EVENT, {
      screen: 'records',
      time_to_first_content_ms: 40,
      time_to_data_ms: 640,
      round_trips: 2,
      cache_hit: true,
      failed: false,
      complete: true,
    });
  });

  it('counts data with nothing shown before it as the first content, from the network', () => {
    const time = clock();
    const send = jest.fn();
    const visit = startScreenVisit('rankings', { ...time, random: () => 0, send });
    time.advance(900);
    visit.data();
    expect(send.mock.calls[0][1]).toMatchObject({ time_to_first_content_ms: 900, time_to_data_ms: 900, cache_hit: false });
  });

  it('reports a visit that left or failed before data arrived', () => {
    const time = clock();
    const left = jest.fn();
    const leftVisit = startScreenVisit('records', { ...time, random: () => 0, send: left });
    time.request();
    leftVisit.finish();
    expect(left.mock.calls[0][1]).toMatchObject({ time_to_data_ms: null, round_trips: 1, complete: false });

    const failed = jest.fn();
    startScreenVisit('records', { ...time, random: () => 0, send: failed }).failed();
    expect(failed.mock.calls[0][1]).toMatchObject({ failed: true, complete: true });
  });

  it(`samples ${SCREEN_TIMING_SAMPLE_RATE * 100}% of visits, and sends nothing without a sender`, () => {
    const time = clock();
    const send = jest.fn();
    startScreenVisit('records', { ...time, random: () => SCREEN_TIMING_SAMPLE_RATE, send }).data();
    startScreenVisit('records', { ...time, random: () => SCREEN_TIMING_SAMPLE_RATE - 0.01, send }).data();
    expect(send).toHaveBeenCalledTimes(1);
    expect(() => startScreenVisit('records', { ...time, random: () => 0, send: null }).data()).not.toThrow();
  });

  it('never lets a failing sender break the screen', () => {
    const time = clock();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const visit = startScreenVisit('records', {
      ...time,
      random: () => 0,
      send: () => {
        throw new Error('posthog');
      },
    });
    expect(() => visit.data()).not.toThrow();
  });
});
