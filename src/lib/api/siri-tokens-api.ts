import { requireToken, userCall } from '@/lib/api/meetcal-api';
import { assertHasFields } from '@/lib/api/api-validators';

export type IssuedApiToken = { token: string; tokenId: string; expiresAt: number };

export async function issueSiriToken(token: string): Promise<IssuedApiToken> {
  const authToken = requireToken(token, 'issueSiriToken');
  const row = assertHasFields(
    await userCall('/api-tokens', 'apiTokens:issue', 'action', authToken, { client: 'siri' }),
    '/api-tokens',
    ['token', 'tokenId', 'expiresAt'],
  );
  if (typeof row.token !== 'string' || row.token.length === 0) throw new Error('/api-tokens.token expected a non-empty string');
  if (typeof row.tokenId !== 'string' || row.tokenId.length === 0) throw new Error('/api-tokens.tokenId expected a non-empty string');
  if (typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt)) throw new Error('/api-tokens.expiresAt expected a number');
  return { token: row.token, tokenId: row.tokenId, expiresAt: row.expiresAt };
}

export async function revokeApiToken(token: string, tokenId?: string): Promise<void> {
  const authToken = requireToken(token, 'revokeApiToken');
  await userCall('/api-tokens/revoke', 'apiTokens:revoke', 'mutation', authToken, tokenId === undefined ? {} : { tokenId });
}
