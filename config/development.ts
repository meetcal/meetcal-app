/**
 * Development configuration and testing flags
 * IMPORTANT: These values are only used in development mode (__DEV__ === true)
 */

import { flatMap } from "lodash";

export const DEV_CONFIG = {
  /**
   * Set to a specific subscription type ('free', 'premium', 'weekpass') to simulate it,
   * or null to disable simulation.
   * This will bypass the real RevenueCat subscription check in development.
   */
  SIMULATE_SUBSCRIPTION: 'weekpass',

  /**
   * Additional development flags can be added here
   */
  ENABLE_API_LOGS: true,
  BYPASS_SPLASH_DELAY: false,
} as const;

/**
 * Helper to get the simulated subscription status
 * Returns:
 * - The simulated type ('free', 'premium', 'weekpass') if enabled in dev mode
 * - null if simulation is disabled or in production
 */
export function getSimulatedSubscriptionStatus(): 'free' | 'premium' | 'weekpass' | null {
  if (__DEV__ && DEV_CONFIG.SIMULATE_SUBSCRIPTION !== undefined) {
    return DEV_CONFIG.SIMULATE_SUBSCRIPTION;
  }
  return null;
} 