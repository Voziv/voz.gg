import { planAutoDesired, desiredGenerationId } from './desired';
import type { ArtifactResolver } from './artifact';
import type { UpdateSource } from '../schema';

export interface ApplyAutoDesiredDeps {
  dao: {
    loadDesiredInputs(): Promise<Array<{
      serverId: string;
      policy: string;
      source: string;
      available: string | null;
      installed: string | null;
      pinned: string | null;
      currentDesiredVersion: string | null;
    }>>;
    writeDesired(serverId: string, d: { id: string; kind: 'apply'; version: string; artifact: { url: string; hashAlgo: string; hash: string; size: number } }): Promise<void>;
    clearDesired(serverId: string): Promise<void>;
  };
  artifactResolverFor: (source: UpdateSource) => ArtifactResolver | null;
  onError?: (serverId: string, err: unknown) => void;
}

// For each auto-policy server with a newer available version, resolve the
// concrete download and record it as the desired apply. Per-server failure
// isolation: a resolver error logs and continues. Only `auto` is handled here;
// `approve`/`rollback` desireds are written by the explicit action endpoints.
export async function applyAutoDesired(deps: ApplyAutoDesiredDeps): Promise<void> {
  const inputs = await deps.dao.loadDesiredInputs();
  for (const input of inputs) {
    const plan = planAutoDesired({
      policy: input.policy as never,
      source: input.source as never,
      available: input.available,
      installed: input.installed,
      pinned: input.pinned,
      currentDesiredVersion: input.currentDesiredVersion,
    });
    if (!plan) continue;
    try {
      const resolver = deps.artifactResolverFor(input.source as UpdateSource);
      if (!resolver) continue;
      const artifact = await resolver.resolveArtifact(plan.version, globalThis.fetch as never);
      await deps.dao.writeDesired(input.serverId, {
        id: desiredGenerationId('apply', plan.version),
        kind: 'apply',
        version: plan.version,
        artifact,
      });
    } catch (err) {
      deps.onError?.(input.serverId, err);
    }
  }
}
