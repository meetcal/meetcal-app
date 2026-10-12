import type { ApiCall, Transport } from '@/lib/api/transport';
import { TransportRequestError } from '@/lib/api/transport-error';

/**
 * Ways a call through the transport can go wrong, applied in front of a real
 * (or stub) transport. One definition of each failure, so the property and
 * chaos tests (`test-support/chaos.ts`) and the development switch
 * `DEV_CONFIG.CHAOS` (`lib/api/dev-chaos.ts`) inject the same faults the
 * network produces:
 *
 * - `network`: fetch's `TypeError` (offline, DNS, a reset connection);
 * - `hang`: no answer at all; settles only when the caller aborts;
 * - `delay`: the real answer, `ms` late (still abortable);
 * - `status`: a refused request, as `toTransportError` reports it;
 * - `transient`: Convex's "busy, try again" failure, which callers retry;
 * - `garbage`: `value` instead of the real answer (a proxy, a schema drift);
 * - `truncate`: the real answer's JSON text cut short (a connection dropped
 *   mid-body).
 */
export type TransportFault =
  | { kind: 'pass' }
  | { kind: 'network' }
  | { kind: 'hang' }
  | { kind: 'delay'; ms: number }
  | { kind: 'status'; status: number }
  | { kind: 'transient' }
  | { kind: 'garbage'; value: unknown }
  | { kind: 'truncate' };

/** Picks the fault for one call; `pass` sends it through untouched. */
export type FaultPicker = (call: ApiCall) => TransportFault;

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/** Resolves after `ms`, or rejects as fetch does when `signal` aborts first. */
function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      reject(abortError());
    };
    const timer = Number.isFinite(ms)
      ? setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, ms)
      : undefined;
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Half of the answer's JSON text, as a `{ json }` answer. */
function truncated(answer: unknown): { json: string } {
  const text =
    answer && typeof answer === 'object' && typeof (answer as { json?: unknown }).json === 'string'
      ? (answer as { json: string }).json
      : (JSON.stringify(answer) ?? '');
  return { json: text.slice(0, Math.floor(text.length / 2)) };
}

export function withTransportFaults(inner: Transport, pick: FaultPicker): Transport {
  return async (call) => {
    const fault = pick(call);
    switch (fault.kind) {
      case 'pass':
        return inner(call);
      case 'network':
        throw new TypeError('Network request failed');
      case 'hang':
        await wait(Number.POSITIVE_INFINITY, call.signal);
        throw abortError();
      case 'delay':
        await wait(fault.ms, call.signal);
        return inner(call);
      case 'status':
        throw new TransportRequestError(
          `${call.kind} ${call.path} failed with ${fault.status}`,
          fault.status,
          JSON.stringify({ status: fault.status, error: 'chaos' }),
        );
      case 'transient':
        throw new Error('Your request could not be processed. Please try again later.');
      case 'garbage':
        return fault.value;
      case 'truncate':
        return truncated(await inner(call));
    }
  };
}
