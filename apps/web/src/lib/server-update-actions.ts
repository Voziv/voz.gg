import { artifactResolverFor as defaultArtifactResolverFor, desiredGenerationId } from '@voz/shared';
import type { ArtifactResolver, UpdateSource } from '@voz/shared';

export interface ServerUpdateActionDao {
  loadActionState(serverId: string): Promise<{ source: UpdateSource | 'none' | null; available: string | null } | null>;
  writeDesired(serverId: string, d: { desiredId: string; kind: 'apply' | 'rollback'; version: string; artifact: { url: string; hashAlgo: string; hash: string; size: number } | null; snapshotId: string | null }): Promise<void>;
  snapshotExists(serverId: string, snapshotId: string): Promise<boolean>;
}

export interface ServerUpdateActionDeps {
  dao: ServerUpdateActionDao;
  artifactResolverFor?: (source: UpdateSource) => ArtifactResolver | null;
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
  await deps.dao.writeDesired(serverId, {
    desiredId: desiredGenerationId('apply', state.available),
    kind: 'apply', version: state.available, artifact, snapshotId: null,
  });
  return { ok: true };
}

export async function requestRollback(deps: ServerUpdateActionDeps, serverId: string, snapshotId: string): Promise<Result> {
  if (!(await deps.dao.snapshotExists(serverId, snapshotId))) return { ok: false, error: 'Unknown snapshot.' };
  await deps.dao.writeDesired(serverId, {
    desiredId: desiredGenerationId('rollback', snapshotId),
    kind: 'rollback', version: snapshotId, artifact: null, snapshotId,
  });
  return { ok: true };
}
