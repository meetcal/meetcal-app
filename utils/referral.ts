import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MeetCalApiError,
  type RedeemReferralErrorCode,
} from '@/lib/api/meetcal-api';

// A referral code captured from a `meetcal://invite/{code}` deep link before
// the user has signed in. Pre-filled into the redeem prompt after sign-up.
const PENDING_REFERRAL_CODE_KEY = 'pending_referral_code_v1';
// Set once the user has completed or skipped the post-signup redeem prompt so
// it is not shown again on every launch.
const REDEEM_PROMPT_SEEN_KEY = 'referral_redeem_prompt_seen_v1';

const KNOWN_ERROR_CODES: RedeemReferralErrorCode[] = [
  'self_referral',
  'already_redeemed',
  'invalid_code',
  'not_eligible',
];

/**
 * Normalize a referral code for storage/submission: trim surrounding
 * whitespace and uppercase it. Returns an empty string for nullish input.
 */
export function normalizeReferralCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

export async function getPendingReferralCode(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(PENDING_REFERRAL_CODE_KEY);
    return value ? normalizeReferralCode(value) : null;
  } catch {
    return null;
  }
}

export async function setPendingReferralCode(code: string): Promise<void> {
  try {
    const normalized = normalizeReferralCode(code);
    if (normalized) {
      await AsyncStorage.setItem(PENDING_REFERRAL_CODE_KEY, normalized);
    }
  } catch {
    // Non-fatal: pre-filling the code is a convenience, not a requirement.
  }
}

export async function clearPendingReferralCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
  } catch {
    // Non-fatal.
  }
}

export async function hasSeenRedeemPrompt(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(REDEEM_PROMPT_SEEN_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function markRedeemPromptSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(REDEEM_PROMPT_SEEN_KEY, 'true');
  } catch {
    // Non-fatal.
  }
}

// How long after an Apple promotional-offer signature is issued the reward is
// treated as "scheduled". The backend 409s a re-claim during this window while
// it waits for the RevenueCat redemption webhook.
export const IOS_OFFER_OUTSTANDING_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Tolerant timestamp parser: accepts an RFC3339/ISO string, a numeric epoch-ms
 * string, or an epoch-ms number. Returns epoch milliseconds, or null if the
 * value is missing or unparseable.
 */
export function parseTimestampMs(
  value: string | number | null | undefined,
): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const epoch = Number(trimmed);
    return Number.isFinite(epoch) ? epoch : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Whether an Apple promotional offer issued at `issuedAt` is still outstanding
 * (recent enough that the reward should render as scheduled, not claimable).
 */
export function isIosOfferOutstanding(
  issuedAt: string | number | null | undefined,
  now: number = Date.now(),
  windowMs: number = IOS_OFFER_OUTSTANDING_WINDOW_MS,
): boolean {
  const ms = parseTimestampMs(issuedAt);
  if (ms == null) return false;
  return now - ms < windowMs;
}

/**
 * Extract the referral redeem error code from a failed request. The backend
 * returns one of the documented codes; we look for it in a JSON `error`/`code`
 * field and fall back to a substring match on the raw body so a slightly
 * different envelope shape still maps to a friendly message.
 */
export function parseRedeemErrorCode(
  error: unknown,
): RedeemReferralErrorCode | null {
  if (!(error instanceof MeetCalApiError)) return null;

  const body = error.body ?? '';
  let candidate: string | null = null;

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const raw = parsed.error ?? parsed.code ?? parsed.message;
    if (typeof raw === 'string') {
      candidate = raw;
    }
  } catch {
    candidate = body;
  }

  if (!candidate) return null;

  return (
    KNOWN_ERROR_CODES.find((code) => candidate!.includes(code)) ?? null
  );
}

const FRIENDLY_MESSAGES: Record<RedeemReferralErrorCode, string> = {
  self_referral: "You can't redeem your own invite code.",
  already_redeemed: 'You have already redeemed an invite code.',
  invalid_code: "That invite code isn't valid. Double-check it and try again.",
  not_eligible:
    'Invite codes can only be redeemed by new subscribers on a new account.',
};

const FALLBACK_MESSAGE =
  "We couldn't redeem that code right now. Please try again later.";

/**
 * Map a failed redeem request to a friendly, user-facing message.
 */
export function redeemErrorMessage(error: unknown): string {
  const code = parseRedeemErrorCode(error);
  return code ? FRIENDLY_MESSAGES[code] : FALLBACK_MESSAGE;
}
