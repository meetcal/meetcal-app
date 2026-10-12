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
