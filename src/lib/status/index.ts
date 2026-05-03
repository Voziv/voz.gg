import 'server-only';
import { pingMinecraftJava, type MinecraftStatus } from './minecraft';
import type { GameType, Server } from '@/db/schema';

export type StatusResult =
  | (MinecraftStatus & { kind: 'minecraft-java' })
  | { kind: 'unknown'; status: 'unknown' };

const TTL_MS = 30 * 1000;
const cache = new Map<string, { value: StatusResult; expiresAt: number }>();

function cacheKey(gameType: GameType, host: string, port: number) {
  return `${gameType}|${host.toLowerCase()}|${port}`;
}

export async function checkServerStatus(
  server: Pick<Server, 'gameType' | 'host' | 'port'>,
): Promise<StatusResult> {
  const gameType = server.gameType as GameType;
  const key = cacheKey(gameType, server.host, server.port);
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  let value: StatusResult;
  switch (gameType) {
    case 'minecraft-java': {
      const status = await pingMinecraftJava(server.host, server.port);
      value = { kind: 'minecraft-java', ...status };
      break;
    }
    default:
      value = { kind: 'unknown', status: 'unknown' };
  }

  cache.set(key, { value, expiresAt: now + TTL_MS });
  return value;
}
