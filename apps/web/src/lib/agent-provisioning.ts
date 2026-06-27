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
    updates: {
      enabled: boolean;
      policy: 'notify' | 'approve' | 'auto';
      desired:
        | null
        | {
            id: string;
            kind: 'apply' | 'rollback';
            version: string | null;
            artifact: { url: string; hashAlgo: 'sha1' | 'sha256'; hash: string; size: number } | null;
            snapshotId: string | null;
          };
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
  updateSource: 'none' | 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'modpack' | null;
  updatePolicy: 'notify' | 'approve' | 'auto' | null;
  desiredId: string | null;
  desiredKind: 'apply' | 'rollback' | null;
  desiredVersion: string | null;
  desiredArtifactUrl: string | null;
  desiredArtifactHashAlgo: 'sha1' | 'sha256' | null;
  desiredArtifactHash: string | null;
  desiredArtifactSize: number | null;
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
      updates: {
        enabled: (server.updateSource ?? 'none') !== 'none',
        policy: server.updatePolicy ?? 'notify',
        desired: server.desiredId
          ? {
              id: server.desiredId,
              kind: server.desiredKind ?? 'apply',
              version: server.desiredKind === 'rollback' ? null : server.desiredVersion,
              artifact: server.desiredArtifactUrl
                ? {
                    url: server.desiredArtifactUrl,
                    hashAlgo: server.desiredArtifactHashAlgo ?? 'sha1',
                    hash: server.desiredArtifactHash ?? '',
                    size: server.desiredArtifactSize ?? 0,
                  }
                : null,
              snapshotId: server.desiredKind === 'rollback' ? server.desiredVersion : null,
            }
          : null,
      },
    },
  };
}
