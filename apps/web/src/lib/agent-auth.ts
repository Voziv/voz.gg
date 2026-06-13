import { hashToken, bearerToken } from '@voz/shared';

export { hashToken, bearerToken };

export function generateToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}

export interface TokenResolver {
  findServerIdByAgentTokenHash(hash: string): Promise<string | null>;
}

export async function serverIdForToken(dao: TokenResolver, token: string): Promise<string | null> {
  return dao.findServerIdByAgentTokenHash(await hashToken(token));
}
