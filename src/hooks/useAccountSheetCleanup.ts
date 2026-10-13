import { useCallback, useRef } from "react";
import { clearLocalUserData } from "@/lib/account-deletion";

/**
 * What the profile screen's Clerk account sheet leaves behind (#250). The
 * sheet offers "Delete account" whichever way it was opened (the deletion
 * warning or Edit Profile), and a sign-out inside it cannot be told from a
 * deletion, so the device's copy of the signed-in user's saved sessions and
 * queued writes is cleared either way; the server's copy comes back on the
 * next sign-in.
 */
export function useAccountSheetCleanup() {
  const accountUserId = useRef<string | null>(null);
  /** The sheet opened for `userId`. */
  const opened = useCallback((userId: string | null | undefined) => {
    accountUserId.current = userId ?? null;
  }, []);
  /** Signed out from inside the sheet: clears that user's device data. Never rejects. */
  const signedOut = useCallback(async () => {
    const userId = accountUserId.current;
    accountUserId.current = null;
    if (!userId) return;
    await clearLocalUserData(userId).catch((error) => console.error("Error clearing the deleted account's data:", error));
  }, []);
  return { opened, signedOut };
}
