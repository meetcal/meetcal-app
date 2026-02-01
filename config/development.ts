/**
 * Development configuration and testing flags
 * IMPORTANT: These values are only used in development mode (__DEV__ === true)
 */

import { flatMap } from "lodash";

export const DEV_CONFIG = {
  /**
   * Set to true to simulate an active subscription
   * This will bypass the real RevenueCat subscription check
   */
  SIMULATE_SUBSCRIPTION: true,

  /**
   * Simulate offline mode for testing
   * When true, network checks will always return false
   */
  SIMULATE_OFFLINE: false as boolean,

  /**
   * Additional development flags can be added here
   */
  ENABLE_API_LOGS: true,
  BYPASS_SPLASH_DELAY: false,
};

/**
 * Helper to get the simulated subscription status
 * Returns:
 * - true/false if simulation is enabled in dev mode
 * - null if simulation is disabled or in production
 */
export function getSimulatedSubscriptionStatus(): boolean | null {
  if (__DEV__ && DEV_CONFIG.SIMULATE_SUBSCRIPTION !== undefined) {
    return DEV_CONFIG.SIMULATE_SUBSCRIPTION;
  }
  return null;
}

/**
 * Helper to check if offline mode is simulated
 * Returns true if we should simulate offline mode in dev
 */
export function isOfflineModeSimulated(): boolean {
  return __DEV__ && DEV_CONFIG.SIMULATE_OFFLINE === true;
} 