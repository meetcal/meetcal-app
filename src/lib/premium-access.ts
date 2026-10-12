import type { ToastOptions } from "@/lib/toast";

/**
 * What the app may do with a premium feature right now.
 *
 * `isSubscribed` is `null` ("unknown") at launch, offline with no cached
 * entitlement, and after a SecureStore or RevenueCat error. Call sites used
 * to read that three ways: some opened the paywall (so a paying user offline
 * was asked to buy what they own), some did nothing on tap, and the Offline
 * Data screen blanked behind a spinner on every background refresh. One rule
 * now: a known answer wins, even while a background refresh runs; unknown is
 * "checking" while a check is in flight and "unknown" otherwise. Neither of
 * the last two ever opens the paywall.
 *
 * Subscription state is a client-side soft gate (AGENTS.md); this decides UI,
 * never a write.
 */
export type PremiumAccess = "granted" | "denied" | "checking" | "unknown";

export function resolvePremiumAccess({
  isSubscribed,
  isLoading,
}: {
  isSubscribed: boolean | null;
  isLoading: boolean;
}): PremiumAccess {
  if (isSubscribed === true) return "granted";
  if (isSubscribed === false) return "denied";
  return isLoading ? "checking" : "unknown";
}

export type PremiumAction =
  | { kind: "proceed" }
  | { kind: "paywall" }
  | { kind: "notify"; toast: ToastOptions };

const CHECKING_TOAST: ToastOptions = {
  type: "info",
  message: "Checking your subscription. Try again in a moment.",
};

const UNKNOWN_TOAST: ToastOptions = {
  type: "info",
  message: "Can't confirm your subscription right now. Connect to the internet and try again.",
};

/** The feedback for a tap on a premium action while the answer is not known. */
export function premiumPendingToast(access: "checking" | "unknown"): ToastOptions {
  return access === "checking" ? CHECKING_TOAST : UNKNOWN_TOAST;
}

/** What a tap on a premium action does, given the current access. */
export function premiumActionFor(access: PremiumAccess): PremiumAction {
  switch (access) {
    case "granted":
      return { kind: "proceed" };
    case "denied":
      return { kind: "paywall" };
    case "checking":
    case "unknown":
      return { kind: "notify", toast: premiumPendingToast(access) };
  }
}
