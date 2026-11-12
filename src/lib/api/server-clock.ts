import { callApi, type ApiCall } from '@/lib/api/transport';

export type ServerClockSample = {
  skewMs: number;
  sampledAt: number;
};

export const MAX_PLAUSIBLE_CLOCK_SKEW_MS = 15 * 60 * 1000;
export const SERVER_CLOCK_RESAMPLE_MS = 10 * 60 * 1000;
export const SERVER_CLOCK_DECISION_GRACE_MS = 2000;
const SERVER_CLOCK_SAMPLE_TIMEOUT_MS = 10000;
const MAX_CLOCK_SAMPLE_ROUND_TRIP_MS = 5000;

export const SERVER_CLOCK_CALL: ApiCall = { path: '/clock', fn: 'system:ping', kind: 'clock', args: {} };

let serverClockSample: ServerClockSample | null = null;
let serverClockInFlight: Promise<void> | null = null;

function waitAtMost(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function sampleServerClock(): Promise<void> {
  if (serverClockInFlight) return serverClockInFlight;
  const sentAt = Date.now();
  const sample = callApi(SERVER_CLOCK_CALL)
    .then((serverNow) => {
      if (typeof serverNow !== 'number' || !Number.isFinite(serverNow)) return;
      const receivedAt = Date.now();
      if (receivedAt - sentAt > MAX_CLOCK_SAMPLE_ROUND_TRIP_MS) return;
      const roundTripMidpoint = (sentAt + receivedAt) / 2;
      serverClockSample = { skewMs: serverNow - roundTripMidpoint, sampledAt: receivedAt };
    })
    .catch(() => {});
  serverClockInFlight = waitAtMost(sample, SERVER_CLOCK_SAMPLE_TIMEOUT_MS).finally(() => {
    serverClockInFlight = null;
  });
  return serverClockInFlight;
}

export function sampleServerClockWhenStale(): void {
  const isStale =
    serverClockSample === null || Date.now() - serverClockSample.sampledAt > SERVER_CLOCK_RESAMPLE_MS;
  if (isStale) void sampleServerClock();
}

export async function refreshServerClock(): Promise<ServerClockSample | null> {
  await sampleServerClock();
  return serverClockSample;
}

export async function awaitServerClock(
  maxWaitMs: number = SERVER_CLOCK_DECISION_GRACE_MS,
): Promise<ServerClockSample | null> {
  if (serverClockSample) return serverClockSample;
  await waitAtMost(sampleServerClock(), maxWaitMs);
  return serverClockSample;
}

export function getServerClockSample(): ServerClockSample | null {
  return serverClockSample;
}

export function getServerClockSkewMs(): number | null {
  return serverClockSample?.skewMs ?? null;
}

export function getTrustedNow(): Date | null {
  if (!serverClockSample) return null;
  return new Date(Date.now() + serverClockSample.skewMs);
}

export function resetServerClockForTests(): void {
  serverClockSample = null;
  serverClockInFlight = null;
}
