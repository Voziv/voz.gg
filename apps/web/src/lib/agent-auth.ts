import { sha256Hex } from './agent-config';

export function generateToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}

export function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export interface TokenResolver {
  findServerIdByAgentTokenHash(hash: string): Promise<string | null>;
}

export async function serverIdForToken(dao: TokenResolver, token: string): Promise<string | null> {
  return dao.findServerIdByAgentTokenHash(await hashToken(token));
}

// Pulls the raw token out of an `Authorization: Bearer <token>` header value.
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
