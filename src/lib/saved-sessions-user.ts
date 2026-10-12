export interface StorageUserInputs {
  /** Clerk's user id, when Clerk has one. */
  clerkUserId: string | null | undefined;
  /** Whether Clerk has finished resolving the session. */
  isClerkLoaded: boolean;
  /** Whether the device believes it is online. */
  hasNetwork: boolean;
  /** The signed-in user id from the SecureStore auth hint, if any. */
  cachedUserId: string | null;
}

/**
 * Whose saved sessions are on screen: Clerk's user, else the cached hint,
 * but only while Clerk cannot answer (still loading, or offline). Same rule
 * as `resolveAuthState` in `utils/authGuard`.
 *
 * The hint used to win whenever Clerk had no user, so after a session was
 * revoked remotely, an online start with Clerk loaded and signed out still
 * showed the previous user's sessions on the Saved tab and the widget until
 * the app restarted. Writes were already blocked; this is the read side.
 */
export function resolveStorageUserId({
  clerkUserId,
  isClerkLoaded,
  hasNetwork,
  cachedUserId,
}: StorageUserInputs): string | null {
  if (clerkUserId) return clerkUserId;
  if (isClerkLoaded && hasNetwork) return null;
  return cachedUserId;
}
