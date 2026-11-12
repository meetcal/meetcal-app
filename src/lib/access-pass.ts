import * as SecureStore from 'expo-secure-store';

import { fetchAccessPass, refreshServerEntitlement } from '@/lib/api/entitlement-api';
import { MeetCalApiError } from '@/lib/api/meetcal-api';
import type { AccessPass, HeldPassStore } from '@/lib/api/premium-queries';

/**
 * Gets the shared access pass for the signed-in subscriber. The server knows
 * a subscription from RevenueCat's webhook, which lands after a purchase does
 * and never came for lifetime purchases made before it existed; so when it
 * answers 403 the app asks it to check RevenueCat now
 * (`entitlements:refresh`) and, if it finds the subscription, asks once more.
 * Null when there is no pass to be had: signed out, or not subscribed.
 */
export async function loadAccessPass(getToken: () => Promise<string | null>): Promise<AccessPass | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    return await fetchAccessPass(token);
  } catch (error) {
    if (!(error instanceof MeetCalApiError) || error.status !== 403) throw error;
  }
  const { active } = await refreshServerEntitlement(token);
  return active ? await fetchAccessPass(token) : null;
}

export const ACCESS_PASS_STORAGE_KEY = 'meetcal_access_pass_v1';

export function parseStoredAccessPass(raw: string | null, owner: string): AccessPass | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.owner !== owner) return null;
  if (typeof record.pass !== 'string' || record.pass.length === 0) return null;
  if (typeof record.rotatesAt !== 'number' || !Number.isFinite(record.rotatesAt)) return null;
  return { pass: record.pass, rotatesAt: record.rotatesAt };
}

export function storedAccessPassFor(owner: string): HeldPassStore {
  return {
    read: async () => parseStoredAccessPass(await SecureStore.getItemAsync(ACCESS_PASS_STORAGE_KEY), owner),
    write: (pass) =>
      SecureStore.setItemAsync(
        ACCESS_PASS_STORAGE_KEY,
        JSON.stringify({ owner, pass: pass.pass, rotatesAt: pass.rotatesAt }),
      ),
    forget: forgetStoredAccessPass,
  };
}

export function forgetStoredAccessPass(): Promise<void> {
  return SecureStore.deleteItemAsync(ACCESS_PASS_STORAGE_KEY);
}
