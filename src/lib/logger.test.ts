import { devInfo, devLog, devWarn } from './logger';

describe('dev-only logging helpers', () => {
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
    jest.restoreAllMocks();
  });

  function setDev(value: boolean) {
    (globalThis as { __DEV__?: boolean }).__DEV__ = value;
  }

  it('forwards to the console in development', () => {
    setDev(true);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    devLog('a', 1);
    devWarn('b');
    devInfo('c');

    expect(log).toHaveBeenCalledWith('a', 1);
    expect(warn).toHaveBeenCalledWith('b');
    expect(info).toHaveBeenCalledWith('c');
  });

  it('stays silent in a production build', () => {
    setDev(false);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    devLog('a');
    devWarn('b');
    devInfo('c');

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('reads __DEV__ at call time rather than at import time', () => {
    setDev(false);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    devLog('quiet');
    expect(log).not.toHaveBeenCalled();

    setDev(true);
    devLog('loud');
    expect(log).toHaveBeenCalledWith('loud');
  });
});
