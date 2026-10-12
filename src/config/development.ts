/**
 * Development configuration and testing flags
 * IMPORTANT: These values are only used in development mode (__DEV__ === true)
 */

import { validateChaosConfig, type ChaosConfig } from '@/lib/api/dev-chaos';
import { isMaestroE2E } from '@/lib/e2e';

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
   * Random backend failures, to watch the app degrade on a simulator. null
   * is off. Otherwise a share of calls (`rate`, 0 to 1) fails with a fault
   * drawn from `kinds` (default: network, HTTP 503/500/429, Convex "try again
   * later", a `latencyMs` delay, truncated JSON; `hang` and `garbage` only
   * when listed). Each fault is logged as `[chaos]`. For example:
   * `{ rate: 0.3, latencyMs: { min: 500, max: 4000 } }`.
   */
  CHAOS: null as ChaosConfig | null,
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

/**
 * The chaos config to apply to backend calls, or null for none: always null
 * in a release build and under Maestro, whose flows assert what a screen
 * shows and would fail at random instead of on a regression. Throws when
 * `DEV_CONFIG.CHAOS` is set but invalid.
 */
export function getChaosConfig(): ChaosConfig | null {
  if (!__DEV__ || isMaestroE2E() || DEV_CONFIG.CHAOS === null) return null;
  try {
    return validateChaosConfig(DEV_CONFIG.CHAOS);
  } catch (error) {
    // Also on the console: the error itself may end up behind a screen's
    // generic "could not load" state.
    console.error(error);
    throw error;
  }
}
