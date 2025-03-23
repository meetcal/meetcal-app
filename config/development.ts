/**
 * Development configuration and testing flags
 * IMPORTANT: These values are only used in development mode (__DEV__ === true)
 */

export const DEV_CONFIG = {
  /**
   * Set to true to simulate an active subscription
   * This will bypass the real RevenueCat subscription check
   */
  SIMULATE_SUBSCRIPTION: true,

  /**
   * Additional development flags can be added here
   */
  ENABLE_API_LOGS: true,
  BYPASS_SPLASH_DELAY: false,
} as const;

/**
 * Helper to check if we should use simulated subscription
 */
export const shouldUseSimulatedSubscription = () => {
  return __DEV__ && DEV_CONFIG.SIMULATE_SUBSCRIPTION;
};

/**
 * Helper to get the simulated subscription status
 */
export const getSimulatedSubscriptionStatus = () => {
  return shouldUseSimulatedSubscription() ? true : null;
}; 