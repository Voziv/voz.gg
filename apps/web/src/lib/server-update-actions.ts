import { artifactResolverFor as defaultArtifactResolverFor, desiredGenerationId, isLoaderSource, loaderInstallDescriptor } from '@voz/shared';
import { resolveOverallLatest as defaultResolveOverall, buildMajorDesired, generationOf } from '@voz/shared';
import type { ArtifactResolver, InstallDescriptor, UpdateSource } from '@voz/shared';
import type { OverallLatest, ResolverConfig } from '@voz/shared';

export interface ServerUpdateActionDao {
  loadActionState(serverId: string): Promise<{ source: UpdateSource | 'none' | null; available: string | null; versionLine: string | null } | null>;
  writeDesired(serverId: string, d: { desiredId: string; kind: 'apply' | 'rollback'; version: string; artifact: { url: string; hashAlgo: string; hash: string; size: number } | null; snapshotId: string | null; install: InstallDescriptor | null }): Promise<void>;
  snapshotExists(serverId: string, snapshotId: string): Promise<boolean>;
  loadMajorActionState(serverId: string): Promise<{ source: UpdateSource | 'none' | null; availableMajor: string | null; installed: string | null; versionLine: string | null; channel: string | null; provider: string | null } | null>;
  advanceMajor(serverId: string, d: { versionLine: string; desired: { id: string; version: string; artifact: { url: string; hashAlgo: string; hash: string; size: number }; install: { loader: 'forge' | 'neoforge' | 'fabric'; minecraftVersion: string; loaderVersion: string } | null } }): Promise<void>;
}

export interface ServerUpdateActionDeps {
  dao: ServerUpdateActionDao;
  artifactResolverFor?: (source: UpdateSource) => ArtifactResolver | null;
  resolveOverallLatest?: (source: UpdateSource, config: ResolverConfig, fetch: never) => Promise<OverallLatest | null>;
}

type Result = { ok: true } | { ok: false; error: string };

export async function approveUpdate(deps: ServerUpdateActionDeps, serverId: string): Promise<Result> {
  const resolverFor = deps.artifactResolverFor ?? defaultArtifactResolverFor;
  const state = await deps.dao.loadActionState(serverId);
  if (!state || !state.source || state.source === 'none') return { ok: false, error: 'Server is not tracked for updates.' };
  if (!state.available) return { ok: false, error: 'No update is available to approve.' };
  const resolver = resolverFor(state.source as UpdateSource);
  if (!resolver) return { ok: false, error: 'Updates are not supported for this source yet.' };
  let artifact;
  try {
    artifact = await resolver.resolveArtifact(state.available, globalThis.fetch as never);
  } catch (err) {
    return { ok: false, error: `Could not resolve the download: ${(err as Error).message}` };
  }
  let install: InstallDescriptor | null = null;
  if (isLoaderSource(state.source)) {
    try {
      install = loaderInstallDescriptor(state.source, state.available, state.versionLine);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  await deps.dao.writeDesired(serverId, {
    desiredId: desiredGenerationId('apply', state.available),
    kind: 'apply', version: state.available, artifact, snapshotId: null, install,
  });
  return { ok: true };
}

export async function requestRollback(deps: ServerUpdateActionDeps, serverId: string, snapshotId: string): Promise<Result> {
  if (!(await deps.dao.snapshotExists(serverId, snapshotId))) return { ok: false, error: 'Unknown snapshot.' };
  await deps.dao.writeDesired(serverId, {
    desiredId: desiredGenerationId('rollback', snapshotId),
    kind: 'rollback', version: snapshotId, artifact: null, snapshotId, install: null,
  });
  return { ok: true };
}

export async function approveMajorUpdate(deps: ServerUpdateActionDeps, serverId: string): Promise<Result> {
  const resolverFor = deps.artifactResolverFor ?? defaultArtifactResolverFor;
  const resolveOverall = deps.resolveOverallLatest ?? defaultResolveOverall;
  const state = await deps.dao.loadMajorActionState(serverId);
  if (!state || !state.source || state.source === 'none') return { ok: false, error: 'Server is not tracked for updates.' };
  if (!state.availableMajor) return { ok: false, error: 'No major update is available to approve.' };
  const source = state.source as UpdateSource;
  let overall: OverallLatest | null;
  try {
    overall = await resolveOverall(source, { source, provider: state.provider as never, id: null, channel: state.channel }, globalThis.fetch as never);
  } catch (err) {
    return { ok: false, error: `Could not resolve the update: ${(err as Error).message}` };
  }
  if (!overall || generationOf(overall.mcVersion) !== state.availableMajor) {
    return { ok: false, error: 'The available major changed; refresh and try again.' };
  }
  let desired;
  try {
    desired = await buildMajorDesired(source, overall, resolverFor, globalThis.fetch as never);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!desired) return { ok: false, error: 'Updates are not supported for this source yet.' };
  await deps.dao.advanceMajor(serverId, { versionLine: desired.versionLine, desired });
  return { ok: true };
}
