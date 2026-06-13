import { GAME_TYPE_DEFAULTS, type GameType } from '@voz/shared';

export interface Provisioning {
  runAsUser: string;
  runAsGroup: string;
  capabilities: {
    monitor: { enabled: boolean };
    logParser: { enabled: boolean; gameServerUser: string | null; logPath: string | null };
  };
}

export interface ProvisioningInput {
  gameType: GameType;
  runAsUser: string | null;
  runAsGroup: string | null;
  gameServerUser: string | null;
  logPath: string | null;
  monitorEnabled: boolean | null;
  logParserEnabled: boolean | null;
}

const DEFAULT_RUN_AS = 'voz-gg';

// Resolve install-time provisioning: explicit per-server value > game-type default
// > hard default. The runtime probe never uses these; only the installer does.
export function buildProvisioning(server: ProvisioningInput): Provisioning {
  const defaults = GAME_TYPE_DEFAULTS[server.gameType] ?? {};
  return {
    runAsUser: server.runAsUser ?? DEFAULT_RUN_AS,
    runAsGroup: server.runAsGroup ?? DEFAULT_RUN_AS,
    capabilities: {
      monitor: { enabled: server.monitorEnabled ?? true },
      logParser: {
        enabled: server.logParserEnabled ?? false,
        gameServerUser: server.gameServerUser ?? defaults.gameServerUser ?? null,
        logPath: server.logPath ?? defaults.logPath ?? null,
      },
    },
  };
}
