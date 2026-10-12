import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as fc from 'fast-check';

import { callApi } from '@/lib/api/transport';
import {
  chaosGetToken,
  createChaosSecureStore,
  installChaosTransport,
  installStorageChaos,
  setNetInfoState,
  settlingTransportFaultArb,
  storageFaultArb,
  tokenFaultArb,
} from '@/test-support/chaos';

describe('installChaosTransport', () => {
  it('applies the plan in order, then passes every call through', async () => {
    const chaos = installChaosTransport(async () => 'ok', [{ kind: 'network' }, { kind: 'garbage', value: 7 }]);
    try {
      const call = { path: '/meets', fn: 'meets:list', kind: 'query' as const, args: {} };
      await expect(callApi(call)).rejects.toBeInstanceOf(TypeError);
      await expect(callApi(call)).resolves.toBe(7);
      await expect(callApi(call)).resolves.toBe('ok');
      expect(chaos.calls.map(({ fault }) => fault.kind)).toEqual(['network', 'garbage', 'pass']);
    } finally {
      chaos.restore();
    }
  });

  it('spares the server-clock sample unless asked', async () => {
    const chaos = installChaosTransport(async () => 'ok', [{ kind: 'network' }]);
    try {
      await expect(callApi({ path: '/time', fn: 'system:serverTime', kind: 'query', args: {} })).resolves.toBe('ok');
      expect(chaos.calls[0].fault.kind).toBe('pass');
    } finally {
      chaos.restore();
    }
  });

  it('settles every generated fault without timers', async () => {
    await fc.assert(
      fc.asyncProperty(settlingTransportFaultArb, async (fault) => {
        const chaos = installChaosTransport(async () => ({ json: '[]' }), [fault]);
        try {
          await callApi({ path: '/meets', fn: 'meets:list', kind: 'query', args: {} }).catch(() => undefined);
        } finally {
          chaos.restore();
        }
      }),
    );
  });
});

describe('installStorageChaos', () => {
  beforeEach(() => AsyncStorage.clear());

  it('fails, loses and corrupts according to the plan, then restores the mock', async () => {
    const chaos = installStorageChaos([
      { kind: 'quota' },
      { kind: 'lose-write' },
      { kind: 'pass' },
      { kind: 'corrupt-read', value: '{"tru' },
    ]);
    await expect(AsyncStorage.setItem('a', '1')).rejects.toThrow(/disk is full/);
    await AsyncStorage.setItem('a', '2');
    await AsyncStorage.setItem('b', '3');
    await expect(AsyncStorage.getItem('b')).resolves.toBe('{"tru');
    await expect(AsyncStorage.getItem('a')).resolves.toBeNull();
    chaos.restore();
    await AsyncStorage.setItem('a', '4');
    await expect(AsyncStorage.getItem('a')).resolves.toBe('4');
    expect(chaos.calls.map(({ method }) => method)).toEqual(['setItem', 'setItem', 'setItem', 'getItem', 'getItem']);
  });

  it('corrupts every stored value a multiGet returns, and only those', async () => {
    await AsyncStorage.setItem('a', '1');
    const chaos = installStorageChaos([{ kind: 'corrupt-read', value: 'x' }]);
    try {
      await expect(AsyncStorage.multiGet(['a', 'missing'])).resolves.toEqual([
        ['a', 'x'],
        ['missing', null],
      ]);
    } finally {
      chaos.restore();
    }
  });

  it('never leaves the mock broken after any plan', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(storageFaultArb, { maxLength: 4 }), async (plan) => {
        const chaos = installStorageChaos(plan);
        for (let i = 0; i < plan.length; i++) await AsyncStorage.setItem('k', String(i)).catch(() => undefined);
        chaos.restore();
        await AsyncStorage.setItem('k', 'healthy');
        expect(await AsyncStorage.getItem('k')).toBe('healthy');
      }),
    );
  });
});

describe('createChaosSecureStore', () => {
  it('stores, fails and corrupts on the plan', async () => {
    const store = createChaosSecureStore();
    await store.setItemAsync('auth', 'v1');
    store.setFaults([{ kind: 'reject' }, { kind: 'corrupt-read', value: 'garbled' }, { kind: 'lose-write' }]);
    await expect(store.getItemAsync('auth')).rejects.toThrow(/unavailable/);
    await expect(store.getItemAsync('auth')).resolves.toBe('garbled');
    await store.deleteItemAsync('auth');
    await expect(store.getItemAsync('auth')).resolves.toBe('v1');
    store.reset();
    await expect(store.getItemAsync('auth')).resolves.toBeNull();
  });
});

describe('chaosGetToken', () => {
  it('answers each fault, then the token', async () => {
    const getToken = chaosGetToken('jwt', [{ kind: 'null' }, { kind: 'empty' }, { kind: 'throw' }]);
    await expect(getToken()).resolves.toBeNull();
    await expect(getToken()).resolves.toBe('');
    await expect(getToken()).rejects.toThrow(/Clerk/);
    await expect(getToken()).resolves.toBe('jwt');
  });

  it('only ever answers a string, null, or a failure', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(tokenFaultArb, { maxLength: 4 }), async (plan) => {
        const getToken = chaosGetToken('jwt', plan);
        for (let i = 0; i <= plan.length; i++) {
          const answer = await getToken().catch(() => 'failed');
          expect(answer === null || typeof answer === 'string').toBe(true);
        }
      }),
    );
  });
});

describe('setNetInfoState', () => {
  it('answers fetch and notifies listeners', async () => {
    const listener = jest.fn();
    NetInfo.addEventListener(listener);
    const offline = { isConnected: false, isInternetReachable: null, type: 'none', details: null } as unknown as NetInfoState;
    setNetInfoState(offline);
    expect(listener).toHaveBeenCalledWith(offline);
    await expect(NetInfo.fetch()).resolves.toBe(offline);
  });
});
