import { DEV_CONFIG, getChaosConfig } from '@/config/development';
import { CHAOS_GARBAGE, validateChaosConfig, withDevChaos, type ChaosConfig } from '@/lib/api/dev-chaos';
import { callApi, setApiTransportForTests, type ApiCall } from '@/lib/api/transport';
import { isMaestroE2E } from '@/lib/e2e';

jest.mock('@/lib/e2e', () => ({ isMaestroE2E: jest.fn(() => false) }));

const valid: ChaosConfig = { rate: 0.3, latencyMs: { min: 500, max: 4000 } };
const listMeets: ApiCall = { path: '/meets', fn: 'meets:list', kind: 'query', args: {} };
const clockCall: ApiCall = { path: '/clock', fn: 'system:serverTime', kind: 'mutation', args: {} };

describe('validateChaosConfig', () => {
  it('accepts a valid config, with or without kinds', () => {
    expect(validateChaosConfig(valid)).toBe(valid);
    expect(() => validateChaosConfig({ ...valid, kinds: ['hang', 'garbage'] })).not.toThrow();
    expect(() => validateChaosConfig({ rate: 0, latencyMs: { min: 0, max: 0 } })).not.toThrow();
    expect(() => validateChaosConfig({ rate: 1, latencyMs: { min: 10, max: 10 } })).not.toThrow();
  });

  it.each([-0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY])('rejects rate %p', (rate) => {
    expect(() => validateChaosConfig({ ...valid, rate })).toThrow(/DEV_CONFIG\.CHAOS: rate must be a number in \[0, 1\]/);
  });

  it('rejects a latency range whose min is above its max', () => {
    expect(() => validateChaosConfig({ ...valid, latencyMs: { min: 5000, max: 100 } })).toThrow(
      /latencyMs\.min \(5000\) is greater than latencyMs\.max \(100\)/,
    );
  });

  it('rejects a negative or non-finite latency', () => {
    expect(() => validateChaosConfig({ ...valid, latencyMs: { min: -1, max: 10 } })).toThrow(/latencyMs\.min/);
    expect(() => validateChaosConfig({ ...valid, latencyMs: { min: 0, max: Number.NaN } })).toThrow(/latencyMs\.max/);
  });

  it('rejects an empty or unknown kind list', () => {
    expect(() => validateChaosConfig({ ...valid, kinds: [] })).toThrow(/non-empty/);
    expect(() => validateChaosConfig({ ...valid, kinds: ['pass' as never] })).toThrow(/unknown fault kind "pass"/);
  });

  it('rejects a config that is not an object', () => {
    expect(() => validateChaosConfig(true as never)).toThrow(/must be an object/);
  });
});

describe('withDevChaos', () => {
  it('logs each injected fault with the call it hit', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const transport = withDevChaos(async () => 'ok', { ...valid, rate: 1, kinds: ['status'] }, () => 0);
      await expect(transport(listMeets)).rejects.toMatchObject({ status: 503 });
      expect(log).toHaveBeenCalledWith('[chaos] query /meets (meets:list): status 503');
    } finally {
      log.mockRestore();
    }
  });

  it('answers garbage as a captive portal page, and passes calls quietly', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(withDevChaos(async () => 'ok', { ...valid, rate: 1, kinds: ['garbage'] }, () => 0)(listMeets)).resolves.toBe(
        CHAOS_GARBAGE,
      );
      await expect(withDevChaos(async () => 'ok', { ...valid, rate: 0 }, () => 0)(listMeets)).resolves.toBe('ok');
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it('refuses an invalid config', () => {
    expect(() => withDevChaos(async () => 'ok', { ...valid, rate: 2 })).toThrow(/rate/);
  });
});

describe('callApi under DEV_CONFIG.CHAOS', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success', value: 42 }),
        json: async () => ({ status: 'success', value: 42 }),
      }) as unknown as Response,
  );
  let log: jest.SpyInstance;

  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as unknown as typeof fetch;
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    DEV_CONFIG.CHAOS = { rate: 1, latencyMs: { min: 0, max: 0 }, kinds: ['network'] };
  });

  afterEach(() => {
    DEV_CONFIG.CHAOS = null;
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    jest.mocked(isMaestroE2E).mockReturnValue(false);
    setApiTransportForTests(null);
    log.mockRestore();
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('faults calls before they reach the network', async () => {
    await expect(callApi(listMeets)).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[chaos] query /meets (meets:list): network');
  });

  it('never faults the server-clock sample', async () => {
    await expect(callApi(clockCall)).resolves.toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when CHAOS is null', async () => {
    DEV_CONFIG.CHAOS = null;
    await expect(callApi(listMeets)).resolves.toBe(42);
    expect(getChaosConfig()).toBeNull();
  });

  it('does nothing in a release build', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    expect(getChaosConfig()).toBeNull();
    await expect(callApi(listMeets)).resolves.toBe(42);
    expect(log).not.toHaveBeenCalled();
  });

  it('does nothing under Maestro', async () => {
    jest.mocked(isMaestroE2E).mockReturnValue(true);
    expect(getChaosConfig()).toBeNull();
    await expect(callApi(listMeets)).resolves.toBe(42);
  });

  it('gives way to a test transport', async () => {
    setApiTransportForTests(async () => 'stub');
    await expect(callApi(listMeets)).resolves.toBe('stub');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects every call, loudly, while the config is invalid', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      DEV_CONFIG.CHAOS = { rate: 0.5, latencyMs: { min: 10, max: 1 } };
      await expect(callApi(listMeets)).rejects.toThrow(/DEV_CONFIG\.CHAOS: latencyMs\.min/);
      expect(error).toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
