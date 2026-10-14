import { useRouter } from "expo-router";
import { useCallback } from "react";

import { showToast } from "@/lib/toast";
import { useSubscription } from "@/contexts/SubscriptionContext";
import {
  CALENDAR_EXPORT_IS_PREMIUM,
  premiumActionFor,
  resolvePremiumAccess,
  type PremiumAccess,
} from "@/lib/premium-access";
import { type AuthGuardOptions, useAuthGuard } from "@/utils/authGuard";

export interface RequirePremiumOptions extends AuthGuardOptions {
  /** Where sign-in and the paywall send the user back to. */
  returnPath: string;
}

/**
 * The one gate for a premium *action*: sign-in first (so the paywall never
 * opens for a signed-out user and the intent survives sign-in), then the
 * entitlement. Returns `true` only when the action may run now. Otherwise the
 * user has been told why: the sign-in alert, the paywall, or a toast while
 * sign-in or the subscription cannot be decided (offline, or still checking).
 * An unknown entitlement never opens the paywall; see `lib/premium-access.ts`.
 */
export function useRequirePremium() {
  const { requireAuth } = useAuthGuard();
  const { isSubscribed, isLoading } = useSubscription();
  const router = useRouter();
  const access: PremiumAccess = resolvePremiumAccess({
    isSubscribed,
    isLoading: Boolean(isLoading),
  });

  const requirePremium = useCallback(
    (options: RequirePremiumOptions): boolean => {
      if (requireAuth(options) !== true) return false;

      const action = premiumActionFor(access);
      if (action.kind === "proceed") return true;
      if (action.kind === "paywall") {
        router.push({
          pathname: "/shared-screens/paywall",
          params: { from: options.returnPath, feature: options.feature },
        });
        return false;
      }
      showToast(action.toast);
      return false;
    },
    [access, requireAuth, router],
  );

  /**
   * The one gate for "Add to Calendar" on every screen that has it (the Saved
   * tab, the Start List, session details). Session details used to write the
   * event with no gate at all while the other two required sign-in and the
   * subscription. `CALENDAR_EXPORT_IS_PREMIUM` decides it for all three.
   */
  const requireCalendarExport = useCallback(
    (returnPath: string): boolean => {
      if (!CALENDAR_EXPORT_IS_PREMIUM) return true;
      return requirePremium({
        feature: "add-to-calendar",
        message: "Sign in to add sessions to your calendar.",
        returnPath,
      });
    },
    [requirePremium],
  );

  // `requireAuth` too, so a screen with free and premium actions mounts one
  // auth guard (a SecureStore read and a network probe) rather than two.
  return { requirePremium, requireCalendarExport, requireAuth, access };
}
