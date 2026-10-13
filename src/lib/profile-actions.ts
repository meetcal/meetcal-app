/**
 * Profile actions kept out of the screen so their order and failure handling
 * can be tested: Sign Out and Send Feedback.
 */

/**
 * End the Clerk session, then forget the offline sign-in hint.
 *
 * The other order deleted the hint first, so a sign-out that failed left
 * the user signed in to Clerk with no hint: offline, the Saved tab and
 * widget emptied and gated actions said "You're offline" until the next
 * online launch. Throws when `signOut` fails, with the hint untouched.
 *
 * A hint that fails to clear after a successful sign-out is only logged:
 * the user *is* signed out, and `useAuthGuard` rewrites the hint as signed
 * out the next time Clerk answers online.
 */
export async function signOutThenForgetHint(
  signOut: () => Promise<unknown>,
  forgetHint: () => Promise<void>,
): Promise<void> {
  await signOut();
  try {
    await forgetHint();
  } catch (error) {
    console.warn("[Profile] Signed out, but the offline sign-in hint was not cleared", error);
  }
}

export const FEEDBACK_EMAIL = "maddisen@meetcal.app";
const FEEDBACK_SUBJECT = "MeetCal App Feedback";

export interface FeedbackContext {
  os: string;
  osVersion: string | number;
  /** `expo-application`'s `nativeApplicationVersion`. */
  appVersion: string | null;
  /** `expo-application`'s `nativeBuildVersion`. */
  buildVersion: string | null;
  /** `expo-updates`' `updateId`: null when running the embedded bundle. */
  updateId: string | null;
  user:
    | {
        id?: string | null;
        firstName?: string | null;
        lastName?: string | null;
      }
    | null
    | undefined;
}

/**
 * The `mailto:` URL for Send Feedback. Clerk's name parts are `null` for a
 * user who signed up with email only (or with Apple without sharing a
 * name), which used to print "Name: null null". The app version and OTA
 * update are what a bug report needs first.
 */
export function feedbackMailtoUrl(context: FeedbackContext): string {
  const name = [context.user?.firstName, context.user?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const appVersion = context.appVersion
    ? context.buildVersion
      ? `${context.appVersion} (${context.buildVersion})`
      : context.appVersion
    : "Unknown";

  const body = [
    "---- Device Info ----",
    `OS: ${context.os} ${context.osVersion}`,
    `App Version: ${appVersion}`,
    `Update: ${context.updateId ?? "Embedded"}`,
    "",
    "---- User Info ----",
    `Name: ${name || "Not provided"}`,
    `User ID: ${context.user?.id ?? "Signed out"}`,
    "",
    "---- Feedback ----",
    "",
  ].join("\n");

  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}&body=${encodeURIComponent(body)}`;
}

/** What to tell the user when no mail app can take the `mailto:` link. */
export const NO_MAIL_APP_ALERT = {
  title: "Couldn't open Mail",
  message: `No email app is set up on this device. Send your feedback to ${FEEDBACK_EMAIL}.`,
} as const;
