import { ConvexError } from 'convex/values';

/**
 * Request errors carry the HTTP status the Rust API answered with, so the app
 * client can keep raising `MeetCalApiError` with the same `status` and every
 * caller's 400 / 404 branch keeps working.
 */
export type ApiErrorData = { status: number; error: string; max?: number };

export function apiError(status: number, error: string, extra?: { max?: number }): ConvexError<ApiErrorData> {
  return new ConvexError({ status, error, ...extra });
}

export function requireNonEmpty(field: string, value: string | undefined | null): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw apiError(400, `${field} is required`);
  }
  return value;
}

export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day >= 1 && day <= days;
}

export function requireIsoDate(field: string, value: string | undefined): void {
  if (value !== undefined && !isValidIsoDate(value)) {
    throw apiError(400, `${field} must be a valid YYYY-MM-DD date`);
  }
}

/** Clients on 6.2.0+ always send the cutoff; the Convex API only serves them. */
export function requirePresentIsoDate(field: string, value: string | undefined): string {
  if (value === undefined) throw apiError(400, `${field} is required`);
  requireIsoDate(field, value);
  return value;
}

export const MAX_NAME_LIST_LEN = 100;
export const MAX_NAME_LEN = 400;

/** `require_name_list`: a first name, at most 100 names, each at most 400 bytes. */
export function requireNameList(names: readonly string[]): void {
  requireNonEmpty('names', names[0] ?? '');
  if (names.length > MAX_NAME_LIST_LEN) {
    throw apiError(400, `names exceeds the ${MAX_NAME_LIST_LEN}-name limit`);
  }
  const encoder = new TextEncoder();
  if (names.some((name) => encoder.encode(name).length > MAX_NAME_LEN)) {
    throw apiError(400, `each name must be at most ${MAX_NAME_LEN} bytes`);
  }
}
