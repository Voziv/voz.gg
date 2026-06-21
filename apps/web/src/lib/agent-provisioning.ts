import { GAME_TYPE_DEFAULTS, type GameType } from '@voz/shared';
import { slugifyServerName } from './slug';

export interface Provisioning {
  runAsUser: string;
  runAsGroup: string;
  capabilities: {
    monitor: { enabled: boolean };
    logParser: { enabled: boolean; gameServerUser: string | null; logPath: string | null };
    serverControl: {
      enabled: boolean;
      slug: string;
      serverUser: string | null;
      workingDir: string | null;
      startCommand: string | null;
      restartSchedule: string;
      rconPort: number;
    };
  };
}

export interface ProvisioningInput {
  name: string;
  slug: string | null;
  gameType: GameType;
  runAsUser: string | null;
  runAsGroup: string | null;
  gameServerUser: string | null;
  logPath: string | null;
  monitorEnabled: boolean | null;
  logParserEnabled: boolean | null;
  serverControlEnabled: boolean | null;
  serverWorkingDir: string | null;
  startCommand: string | null;
  restartSchedule: string | null;
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
      serverControl: {
        enabled: server.serverControlEnabled ?? false,
        slug: server.slug ?? slugifyServerName(server.name),
        serverUser: server.gameServerUser ?? defaults.gameServerUser ?? null,
        workingDir: server.serverWorkingDir ?? null,
        startCommand: server.startCommand ?? null,
        restartSchedule: server.restartSchedule ?? '',
        rconPort: 25575,
      },
    },
  };
}
