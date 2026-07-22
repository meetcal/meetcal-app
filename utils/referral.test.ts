import { MeetCalApiError } from '@/lib/api/meetcal-api';
import {
  IOS_OFFER_OUTSTANDING_WINDOW_MS,
  isIosOfferOutstanding,
  normalizeReferralCode,
  parseRedeemErrorCode,
  parseTimestampMs,
  redeemErrorMessage,
} from '@/utils/referral';

function apiError(body: string, status = 400): MeetCalApiError {
  return new MeetCalApiError('redeem failed', status, body);
}

describe('normalizeReferralCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeReferralCode('  ab12cd  ')).toBe('AB12CD');
  });

  it('returns empty string for nullish input', () => {
    expect(normalizeReferralCode(null)).toBe('');
    expect(normalizeReferralCode(undefined)).toBe('');
  });
});

describe('parseRedeemErrorCode', () => {
  it('reads the code from a JSON error field', () => {
    expect(parseRedeemErrorCode(apiError('{"error":"self_referral"}'))).toBe(
      'self_referral',
    );
  });

  it('reads the code from a JSON code field', () => {
    expect(parseRedeemErrorCode(apiError('{"code":"already_redeemed"}'))).toBe(
      'already_redeemed',
    );
  });

  it('falls back to a substring match on the raw body', () => {
    expect(parseRedeemErrorCode(apiError('invalid_code'))).toBe('invalid_code');
  });

  it('returns null for unknown codes', () => {
    expect(parseRedeemErrorCode(apiError('{"error":"boom"}'))).toBeNull();
  });

  it('returns null for non-API errors', () => {
    expect(parseRedeemErrorCode(new Error('network'))).toBeNull();
  });
});

describe('parseTimestampMs', () => {
  it('parses an RFC3339/ISO string', () => {
    expect(parseTimestampMs('2026-07-01T00:00:00Z')).toBe(
      Date.UTC(2026, 6, 1, 0, 0, 0),
    );
  });

  it('parses a numeric epoch-ms string', () => {
    expect(parseTimestampMs('1751328000000')).toBe(1751328000000);
  });

  it('passes through an epoch-ms number', () => {
    expect(parseTimestampMs(1751328000000)).toBe(1751328000000);
  });

  it('returns null for null, empty, or unparseable input', () => {
    expect(parseTimestampMs(null)).toBeNull();
    expect(parseTimestampMs(undefined)).toBeNull();
    expect(parseTimestampMs('')).toBeNull();
    expect(parseTimestampMs('not-a-date')).toBeNull();
  });
});

describe('isIosOfferOutstanding', () => {
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);

  it('is true for an offer issued within the window', () => {
    const issued = new Date(now - 60 * 60 * 1000).toISOString(); // 1h ago
    expect(isIosOfferOutstanding(issued, now)).toBe(true);
  });

  it('is false for an offer older than the window', () => {
    const issued = now - IOS_OFFER_OUTSTANDING_WINDOW_MS - 1000;
    expect(isIosOfferOutstanding(issued, now)).toBe(false);
  });

  it('is false when the timestamp is missing', () => {
    expect(isIosOfferOutstanding(null, now)).toBe(false);
    expect(isIosOfferOutstanding(undefined, now)).toBe(false);
  });
});

describe('redeemErrorMessage', () => {
  it('maps each known code to a distinct friendly message', () => {
    const codes = [
      'self_referral',
      'already_redeemed',
      'invalid_code',
      'not_eligible',
    ] as const;
    const messages = codes.map((code) =>
      redeemErrorMessage(apiError(`{"error":"${code}"}`)),
    );
    expect(new Set(messages).size).toBe(codes.length);
    messages.forEach((message) => expect(message.length).toBeGreaterThan(0));
  });

  it('uses a generic fallback for unknown errors', () => {
    expect(redeemErrorMessage(new Error('network'))).toMatch(/try again/i);
  });
});
