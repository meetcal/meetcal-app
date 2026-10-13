import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOutboxSeededKey, getSavedSessionsOutboxKey } from "@/lib/saved-sessions-outbox";
import { getSavedSessionsKey } from "@/utils/session";

/**
 * Account deletion starts in the app (App Store guideline 5.1.1(v)), in
 * Clerk's native account screen (`components/profile/ClerkAccountModal.tsx`),
 * whose "Delete account" action appears when deletion is enabled for the
 * Clerk instance. The profile's link used to open the web sign-in page, which
 * has no path to deletion at all.
 *
 * Before that screen opens, the user is told what deletion costs them and
 * that a store subscription is billed by Apple or Google, not by MeetCal, so
 * deleting the account does not stop it.
 *
 * The account's data on the server (saved sessions, notes, preferences) is
 * deleted by Clerk's `user.deleted` webhook (`convex/http.ts`); what this
 * device keeps under the user's id goes with `clearLocalUserData`.
 */
export const ACCOUNT_DELETION_TITLE = "Delete Your Account";

export function accountDeletionMessage(os: string): string {
  const store = os === "ios" ? "the App Store" : "Google Play";
  return [
    "Deleting your account can't be undone. You will lose the saved sessions, notes and reminder settings tied to it.",
    `Deleting your account does not cancel your subscription. Cancel it in ${store} first, or it will keep renewing.`,
    'Continue to your account settings and choose "Delete account" at the bottom.',
  ].join("\n\n");
}

/** Where the platform's store manages subscriptions. */
export function subscriptionManagementUrl(os: string): string {
  return os === "ios"
    ? "https://apps.apple.com/account/subscriptions"
    : "https://play.google.com/store/account/subscriptions";
}

/**
 * Removes what this device stores under a user's id: their saved sessions,
 * the outbox of writes not yet sent, and the outbox's seeded flag. Run after
 * the user signs out of the account screen they opened to delete their
 * account, when the account (and so every write still queued for it) is gone.
 */
export async function clearLocalUserData(userId: string): Promise<void> {
  await AsyncStorage.multiRemove([getSavedSessionsKey(userId), getSavedSessionsOutboxKey(userId), getOutboxSeededKey(userId)]);
}
