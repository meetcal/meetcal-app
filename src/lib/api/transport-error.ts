/**
 * A Convex function rejected the request (`ConvexError` with an HTTP status).
 *
 * Its own module, re-exported by `lib/api/transport.ts`, so the fault
 * injector (`lib/api/chaos-transport.ts`) can raise it without importing the
 * transport that, in development, imports the injector (`DEV_CONFIG.CHAOS`):
 * Metro warns about every require cycle.
 */
export class TransportRequestError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'TransportRequestError';
    this.status = status;
    this.body = body;
  }
}
