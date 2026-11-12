import { type AccessPass } from '@/lib/api/premium-queries';
import { requireToken, userCall } from '@/lib/api/meetcal-api';
import { assertHasFields } from '@/lib/api/api-validators';

export async function refreshServerEntitlement(token: string): Promise<{ active: boolean }> {
  const authToken = requireToken(token, 'refreshServerEntitlement');
  const row = assertHasFields(
    await userCall('/users/me/entitlement', 'entitlements:refresh', 'action', authToken),
    '/users/me/entitlement',
    ['active'],
  );
  if (typeof row.active !== 'boolean') throw new Error('/users/me/entitlement.active expected a boolean');
  return { active: row.active };
}

export async function fetchAccessPass(token: string): Promise<AccessPass> {
  const authToken = requireToken(token, 'fetchAccessPass');
  const row = assertHasFields(await userCall('/access-pass', 'accessPass:pass', 'query', authToken), '/access-pass', ['pass', 'rotatesAt']);
  if (typeof row.pass !== 'string' || row.pass.length === 0) throw new Error('/access-pass.pass expected a non-empty string');
  if (typeof row.rotatesAt !== 'number' || !Number.isFinite(row.rotatesAt)) throw new Error('/access-pass.rotatesAt expected a number');
  return { pass: row.pass, rotatesAt: row.rotatesAt };
}
