/**
 * RevenueCat's own entitlement answer in this process, and the RevenueCat
 * app user it was about. The root layout logs RevenueCat in with the Clerk
 * user id, so `appUserId` is comparable with Clerk's.
 */
export interface ConfirmedEntitlement {
  /** The RevenueCat app user the answer described; null when unknown. */
  appUserId: string | null;
  isSubscribed: boolean;
  /** The dev subscription simulation, which stands for whoever is signed in. */
  simulated?: boolean;
}

/**
 * The confirmed entitlement for `userId`, or `null` when RevenueCat has not
 * answered for that user yet. An answer about another account (the previous
 * user, still current for a moment after an account switch, or the
 * anonymous user before `logIn`) is never this user's: a destructive write
 * gated on the subscription (the auto-remove prune) must wait for this
 * user's own answer.
 */
export function confirmedSubscriptionFor(
  entitlement: ConfirmedEntitlement | null,
  userId: string | null | undefined,
): boolean | null {
  if (!entitlement || !userId) return null;
  if (entitlement.simulated) return entitlement.isSubscribed;
  return entitlement.appUserId === userId ? entitlement.isSubscribed : null;
}
