import type { ToastOptions } from "@/lib/toast";

export type PaywallEvent = "purchase" | "restore" | "dismiss";

/**
 * What the paywall does after RevenueCat's view reports an event:
 * - `return`: leave for where the user came from;
 * - `stay`: do nothing. Inline (inside `SubscriptionGate`), the gate swaps the
 *   paywall for the screen once the CustomerInfo listener publishes the new
 *   entitlement; navigating as well popped the screen the user just paid for;
 * - `nothing-restored`: stay and say so. A restore that found no entitlement
 *   used to exit exactly like one that did, so it read as success.
 */
export type PaywallExit = "return" | "stay" | "nothing-restored";

export function paywallExitFor({
  event,
  inline,
  hasEntitlement,
}: {
  event: PaywallEvent;
  inline: boolean;
  hasEntitlement: boolean;
}): PaywallExit {
  if (event === "dismiss") return "return";
  if (event === "restore" && !hasEntitlement) return "nothing-restored";
  return inline ? "stay" : "return";
}

export const NOTHING_RESTORED_TOAST: ToastOptions = {
  type: "info",
  message: "No active subscription was found to restore for this account.",
};

export type PaywallLoadError = "offline" | "failed" | "empty";

/** Copy for the paywall's error state; every one of them offers Try Again. */
export function paywallErrorCopy(error: PaywallLoadError): { title: string; message: string } {
  switch (error) {
    case "offline":
      return {
        title: "You're offline",
        message: "Connect to the internet to see subscription plans.",
      };
    case "empty":
      return {
        title: "No plans available",
        message: "Subscription plans aren't available right now. Please try again later.",
      };
    case "failed":
      return {
        title: "Couldn't load plans",
        message: "Something went wrong loading subscription plans.",
      };
  }
}
