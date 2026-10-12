import { withTransportFaults, type TransportFault } from '@/lib/api/chaos-transport';
import type { ApiCall, Transport } from '@/lib/api/transport';
import { devLog } from '@/lib/logger';

/**
 * `DEV_CONFIG.CHAOS`: random transport faults in a development build, so a
 * developer can watch the real app degrade on a simulator (stale cache
 * banners, retry queues, error states) without pulling the network cable.
 * The faults are the ones the Jest chaos tests inject
 * (`lib/api/chaos-transport.ts`); this module only decides which call gets
 * which, at random. `lib/api/transport.ts` applies it, in `__DEV__` only.
 */

export type ChaosFaultKind = Exclude<TransportFault['kind'], 'pass'>;

export type ChaosConfig = {
  /** Share of calls that fail, in [0, 1]. */
  rate: number;
  /** Bounds, in ms and inclusive, of a `delay` fault's wait. */
  latencyMs: { min: number; max: number };
  /**
   * Faults to draw from, equally likely; `DEFAULT_CHAOS_KINDS` when absent.
   * `hang` (no answer until the caller's timeout) and `garbage` (a captive
   * portal's page instead of the answer) are opt-in: each makes the app look
   * broken in ways that hide the failures the other faults show.
   */
  kinds?: readonly ChaosFaultKind[];
};

export const DEFAULT_CHAOS_KINDS: readonly ChaosFaultKind[] = ['network', 'status', 'transient', 'delay', 'truncate'];

/** A `status` fault's refusals: the server down, failing, and rate limiting. */
export const CHAOS_STATUSES: readonly number[] = [503, 500, 429];

/** A `garbage` fault's answer: what a captive portal sends instead of JSON. */
export const CHAOS_GARBAGE = '<html><body>Sign in to Wi-Fi</body></html>';

const ALL_KINDS: ReadonlySet<string> = new Set<ChaosFaultKind>([
  'network',
  'hang',
  'delay',
  'status',
  'transient',
  'garbage',
  'truncate',
]);

const CONFIG_KEYS: ReadonlySet<string> = new Set(['rate', 'latencyMs', 'kinds']);

function invalid(problem: string): Error {
  return new Error(`DEV_CONFIG.CHAOS: ${problem}`);
}

/**
 * Throws, naming the field, unless `config` is usable; returns it otherwise.
 * A typo here should stop the developer, not quietly test nothing.
 */
export function validateChaosConfig(config: ChaosConfig): ChaosConfig {
  if (typeof config !== 'object' || config === null) throw invalid('must be an object, or null to turn chaos off');
  // `as ChaosConfig | null` in development.ts skips TypeScript's excess-key
  // check, so a misspelt `kinds` would otherwise run the defaults unnoticed.
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw invalid(`unknown key ${JSON.stringify(key)} (expected rate, latencyMs, kinds)`);
  }
  const { rate, latencyMs, kinds } = config;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw invalid(`rate must be a number in [0, 1], got ${String(rate)}`);
  }
  if (typeof latencyMs !== 'object' || latencyMs === null) throw invalid('latencyMs must be { min, max }');
  const { min, max } = latencyMs;
  if (typeof min !== 'number' || !Number.isFinite(min) || min < 0) {
    throw invalid(`latencyMs.min must be a finite number >= 0, got ${String(min)}`);
  }
  if (typeof max !== 'number' || !Number.isFinite(max)) throw invalid(`latencyMs.max must be a finite number, got ${String(max)}`);
  if (min > max) throw invalid(`latencyMs.min (${min}) is greater than latencyMs.max (${max})`);
  if (kinds !== undefined) {
    if (!Array.isArray(kinds) || kinds.length === 0) throw invalid('kinds must be a non-empty list, or left out');
    for (const kind of kinds) {
      if (!ALL_KINDS.has(kind)) throw invalid(`unknown fault kind ${JSON.stringify(kind)}`);
    }
  }
  return config;
}

/** An element of `items` from one draw of `random` in [0, 1). */
function pickOne<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/**
 * The fault for one call. `random` returns [0, 1), as `Math.random` does;
 * tests pass a seeded one. `config` must already be valid.
 */
export function pickChaosFault(config: ChaosConfig, call: ApiCall, random: () => number): TransportFault {
  // The client's clock sample (`SERVER_CLOCK_CALL` in `lib/api/meetcal-api.ts`,
  // the only `clock` call). Never faulted: its failures are swallowed by
  // design, so faulting it shows the developer nothing and only skews the
  // clock the session prune trusts.
  if (call.kind === 'clock') return { kind: 'pass' };
  if (random() >= config.rate) return { kind: 'pass' };
  const kind = pickOne(config.kinds ?? DEFAULT_CHAOS_KINDS, random);
  switch (kind) {
    case 'delay': {
      const { min, max } = config.latencyMs;
      return { kind, ms: Math.min(max, min + Math.floor(random() * (max - min + 1))) };
    }
    case 'status':
      return { kind, status: pickOne(CHAOS_STATUSES, random) };
    case 'garbage':
      return { kind, value: CHAOS_GARBAGE };
    default:
      return { kind };
  }
}

function describeFault(fault: TransportFault): string {
  if (fault.kind === 'delay') return `delay ${fault.ms}ms`;
  if (fault.kind === 'status') return `status ${fault.status}`;
  return fault.kind;
}

/**
 * `inner` behind `config`'s faults, each logged with the call it hit so the
 * developer can match a broken screen to its cause. Validates `config` first.
 */
export function withDevChaos(inner: Transport, config: ChaosConfig, random: () => number = Math.random): Transport {
  validateChaosConfig(config);
  return withTransportFaults(inner, (call) => {
    const fault = pickChaosFault(config, call, random);
    if (fault.kind !== 'pass') devLog(`[chaos] ${call.kind} ${call.path} (${call.fn}): ${describeFault(fault)}`);
    return fault;
  });
}
