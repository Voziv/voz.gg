import { sha256Hex } from '@voz/shared';
import type { GameType } from '@voz/shared';

export interface AgentConfig {
  serverId: string;
  gameType: GameType;
  probeHost: string;
  port: number;
  queryPort: number;
  pollIntervalSeconds: number;
}

interface ServerConfigInput {
  id: string;
  gameType: GameType;
  port: number;
  queryPort?: number | null;
  pollIntervalSeconds?: number | null;
}

const DEFAULT_POLL_INTERVAL_SECONDS = 30;

export function buildAgentConfig(server: ServerConfigInput): AgentConfig {
  return {
    serverId: server.id,
    gameType: server.gameType,
    probeHost: '127.0.0.1',
    port: server.port,
    queryPort: server.queryPort ?? 0,
    pollIntervalSeconds: server.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS,
  };
}

// Stable JSON with recursively sorted object keys. The agent treats the hash as
// opaque, so this canonical form only has to be consistent on the Worker side.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

export function configHash(config: AgentConfig): Promise<string> {
  return sha256Hex(canonicalJson(config));
}
