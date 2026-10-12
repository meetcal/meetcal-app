import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as fc from 'fast-check';

import { withTransportFaults, type TransportFault } from '@/lib/api/chaos-transport';
import { setApiTransportForTests, type ApiCall, type Transport } from '@/lib/api/transport';
import { hostileStringArb } from '@/test-support/arbitraries';

/**
 * Fault injection for Jest: the transport, AsyncStorage, SecureStore, Clerk's
 * `getToken()` and NetInfo, each driven by a plan fast-check generates. A
 * chaos test runs a flow under a random plan and asserts how the app
 * degrades (falls back to an expiring cache, reports a typed error, keeps the
 * write queued), never that it succeeds. Test-only.
 *
 * A plan is a list of faults consumed in order, one per call; once it runs
 * out every call passes through, so a flow always gets a healthy tail to
 * recover on.
 */

export type { TransportFault } from '@/lib/api/chaos-transport';

export const HTTP_FAULT_STATUSES = [400, 401, 403, 404, 408, 409, 413, 429, 500, 502, 503, 504, 560] as const;

/** A fault that settles without timers (no `hang`, no `delay`). */
export const settlingTransportFaultArb: fc.Arbitrary<TransportFault> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<TransportFault>({ kind: 'pass' }) },
  { weight: 2, arbitrary: fc.constant<TransportFault>({ kind: 'network' }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(...HTTP_FAULT_STATUSES).map((status): TransportFault => ({ kind: 'status', status })),
  },
  { weight: 1, arbitrary: fc.constant<TransportFault>({ kind: 'transient' }) },
  {
    weight: 1,
    arbitrary: fc
      .oneof(fc.jsonValue({ maxDepth: 3 }), hostileStringArb, fc.constant(undefined))
      .map((value): TransportFault => ({ kind: 'garbage', value })),
  },
  { weight: 1, arbitrary: fc.constant<TransportFault>({ kind: 'truncate' }) },
);

/** Any fault, including ones that need fake timers to settle. */
export const transportFaultArb: fc.Arbitrary<TransportFault> = fc.oneof(
  { weight: 8, arbitrary: settlingTransportFaultArb },
  { weight: 1, arbitrary: fc.constant<TransportFault>({ kind: 'hang' }) },
  {
    weight: 1,
    arbitrary: fc.integer({ min: 1, max: 30_000 }).map((ms): TransportFault => ({ kind: 'delay', ms })),
  },
);

export function faultPlanArb<T>(fault: fc.Arbitrary<T>, maxLength = 8): fc.Arbitrary<T[]> {
  return fc.array(fault, { maxLength });
}

/** Pops the next fault, or `healthy` once the plan has run out. */
function planCursor<T>(plan: readonly T[], healthy: T): () => T {
  let next = 0;
  return () => (next < plan.length ? plan[next++] : healthy);
}

export type ChaosTransport = {
  /** Every call that reached the transport, with the fault it got. */
  calls: { call: ApiCall; fault: TransportFault }[];
  restore: () => void;
};

/**
 * Installs `inner` behind `plan` as the app's transport. The server-clock
 * sample (`system:serverTime`) passes through untouched unless
 * `faultClockCalls` is set, so a plan's faults land on the calls under test.
 */
export function installChaosTransport(
  inner: Transport,
  plan: readonly TransportFault[],
  { faultClockCalls = false }: { faultClockCalls?: boolean } = {},
): ChaosTransport {
  const nextFault = planCursor<TransportFault>(plan, { kind: 'pass' });
  const calls: ChaosTransport['calls'] = [];
  setApiTransportForTests(
    withTransportFaults(inner, (call) => {
      const fault: TransportFault =
        !faultClockCalls && call.fn === 'system:serverTime' ? { kind: 'pass' } : nextFault();
      calls.push({ call, fault });
      return fault;
    }),
  );
  return { calls, restore: () => setApiTransportForTests(null) };
}

/**
 * Storage failures: a rejected call, a full disk, a write the platform
 * reported as done but lost (a crash before flush), and a read that returns
 * bytes nobody wrote.
 */
export type StorageFault =
  | { kind: 'pass' }
  | { kind: 'reject' }
  | { kind: 'quota' }
  | { kind: 'lose-write' }
  | { kind: 'corrupt-read'; value: string };

export const storageFaultArb: fc.Arbitrary<StorageFault> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<StorageFault>({ kind: 'pass' }) },
  { weight: 1, arbitrary: fc.constant<StorageFault>({ kind: 'reject' }) },
  { weight: 1, arbitrary: fc.constant<StorageFault>({ kind: 'quota' }) },
  { weight: 1, arbitrary: fc.constant<StorageFault>({ kind: 'lose-write' }) },
  {
    weight: 1,
    arbitrary: fc
      .oneof(hostileStringArb, fc.jsonValue({ maxDepth: 2 }).map((value) => JSON.stringify(value)))
      .map((value): StorageFault => ({ kind: 'corrupt-read', value })),
  },
);

function storageError(fault: StorageFault): Error | null {
  if (fault.kind === 'reject') return new Error('chaos: storage unavailable');
  if (fault.kind === 'quota') return new Error('database or disk is full (code 13 SQLITE_FULL)');
  return null;
}

const READS = ['getItem', 'multiGet', 'getAllKeys'] as const;
const WRITES = ['setItem', 'multiSet', 'removeItem', 'multiRemove', 'mergeItem', 'multiMerge', 'clear'] as const;

type AsyncStorageMock = Record<(typeof READS)[number] | (typeof WRITES)[number], jest.Mock>;

export type StorageChaos = {
  /** Every storage call, with the fault it got. */
  calls: { method: string; fault: StorageFault }[];
  restore: () => void;
};

/**
 * Puts the global AsyncStorage mock (`jest.setup.js`) behind `plan`. Faults
 * that make no sense for a call degrade to `pass` (a lost read, a corrupted
 * write); `corrupt-read` on `getItem` returns its value, on `multiGet` every
 * stored value it returns. `restore()` puts the mock's own behaviour back.
 */
export function installStorageChaos(plan: readonly StorageFault[]): StorageChaos {
  const storage = AsyncStorage as unknown as AsyncStorageMock;
  const nextFault = planCursor<StorageFault>(plan, { kind: 'pass' });
  const calls: StorageChaos['calls'] = [];
  const originals = new Map<string, (...args: unknown[]) => unknown>();
  // The mock builds `setItem` on `multiSet` and `getItem` on `multiGet`; the
  // inner call starts synchronously, and it is the same operation, so it takes
  // no fault of its own.
  let inside = false;

  for (const method of [...READS, ...WRITES]) {
    const original = storage[method].getMockImplementation() as (...args: unknown[]) => unknown;
    originals.set(method, original);
    const isWrite = (WRITES as readonly string[]).includes(method);
    storage[method].mockImplementation(async (...args: unknown[]) => {
      if (inside) return original(...args);
      const fault = nextFault();
      calls.push({ method, fault });
      const error = storageError(fault);
      if (error) throw error;
      if (isWrite && fault.kind === 'lose-write') return null;
      inside = true;
      let pending: unknown;
      try {
        pending = original(...args);
      } finally {
        inside = false;
      }
      const result = await pending;
      if (!isWrite && fault.kind === 'corrupt-read') {
        if (method === 'getItem') return result === null ? null : fault.value;
        if (method === 'multiGet') {
          return (result as [string, string | null][]).map(([key, value]) => [key, value === null ? null : fault.value]);
        }
      }
      return result;
    });
  }

  return {
    calls,
    restore: () => {
      for (const [method, original] of originals) {
        storage[method as keyof AsyncStorageMock].mockImplementation(original);
      }
    },
  };
}

/**
 * An in-memory `expo-secure-store` with the same failure plan as AsyncStorage
 * (Keychain reads fail while the device is locked; writes can fail outright).
 * Use it inside `jest.mock('expo-secure-store', ...)` (assign it to a
 * `mock`-prefixed variable) and set `faults` per case.
 */
export function createChaosSecureStore() {
  const data = new Map<string, string>();
  let nextFault = planCursor<StorageFault>([], { kind: 'pass' });
  const take = () => {
    const fault = nextFault();
    const error = storageError(fault);
    if (error) throw error;
    return fault;
  };
  return {
    data,
    setFaults(plan: readonly StorageFault[]) {
      nextFault = planCursor<StorageFault>(plan, { kind: 'pass' });
    },
    reset() {
      data.clear();
      nextFault = planCursor<StorageFault>([], { kind: 'pass' });
    },
    getItemAsync: jest.fn(async (key: string) => {
      const fault = take();
      const value = data.get(key) ?? null;
      return fault.kind === 'corrupt-read' && value !== null ? fault.value : value;
    }),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      if (take().kind !== 'lose-write') data.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      if (take().kind !== 'lose-write') data.delete(key);
    }),
  };
}

/** What Clerk's `getToken()` does next: a token, no session, or a failure. */
export type TokenFault = { kind: 'token' } | { kind: 'null' } | { kind: 'throw' } | { kind: 'empty' };

export const tokenFaultArb: fc.Arbitrary<TokenFault> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<TokenFault>({ kind: 'token' }) },
  { weight: 1, arbitrary: fc.constant<TokenFault>({ kind: 'null' }) },
  { weight: 1, arbitrary: fc.constant<TokenFault>({ kind: 'throw' }) },
  { weight: 1, arbitrary: fc.constant<TokenFault>({ kind: 'empty' }) },
);

/** A `getToken` that answers `token` unless `plan` says otherwise. */
export function chaosGetToken(token: string, plan: readonly TokenFault[]): jest.Mock<Promise<string | null>, []> {
  const nextFault = planCursor<TokenFault>(plan, { kind: 'token' });
  return jest.fn(async () => {
    const fault = nextFault();
    if (fault.kind === 'throw') throw new Error('chaos: Clerk could not refresh the session');
    if (fault.kind === 'null') return null;
    if (fault.kind === 'empty') return '';
    return token;
  });
}

/** NetInfo states, including the cold-start "still probing" ones. */
export const netInfoStateArb: fc.Arbitrary<NetInfoState> = fc
  .record({
    isConnected: fc.constantFrom(true, false, null),
    isInternetReachable: fc.constantFrom(true, false, null, undefined),
    type: fc.constantFrom('wifi', 'cellular', 'none', 'unknown'),
  })
  .map((state) => ({ details: null, ...state }) as unknown as NetInfoState);

/**
 * Makes `state` the network NetInfo reports: its `fetch()` answers it from now
 * on, and every listener registered so far (`lib/networkUtils.ts` registers
 * one at import) hears it as a change.
 */
export function setNetInfoState(state: NetInfoState): void {
  (NetInfo.fetch as jest.Mock).mockResolvedValue(state);
  for (const [listener] of (NetInfo.addEventListener as jest.Mock).mock.calls) listener(state);
}
