import { planAutoDesired, desiredGenerationId } from './desired';
import { isLoaderSource, loaderInstallDescriptor, type InstallDescriptor } from './loader-install';
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
      versionLine: string | null;
    }>>;
    writeDesired(serverId: string, d: {
      id: string; kind: 'apply'; version: string;
      artifact: { url: string; hashAlgo: string; hash: string; size: number };
      install: InstallDescriptor | null;
    }): Promise<void>;
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
      const source = input.source as UpdateSource;
      const resolver = deps.artifactResolverFor(source);
      if (!resolver) continue;
      const artifact = await resolver.resolveArtifact(plan.version, globalThis.fetch as never);
      const install = isLoaderSource(source)
        ? loaderInstallDescriptor(source, plan.version, input.versionLine)
        : null;
      await deps.dao.writeDesired(input.serverId, {
        id: desiredGenerationId('apply', plan.version),
        kind: 'apply',
        version: plan.version,
        artifact,
        install,
      });
    } catch (err) {
      deps.onError?.(input.serverId, err);
    }
  }
}
