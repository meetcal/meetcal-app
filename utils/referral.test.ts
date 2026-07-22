import { MeetCalApiError } from '@/lib/api/meetcal-api';
import {
  normalizeReferralCode,
  parseRedeemErrorCode,
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
