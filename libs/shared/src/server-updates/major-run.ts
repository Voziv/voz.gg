import { resolveOverallLatest, planMajorOffer, type OverallLatest } from './major-detect';
import { generationOf, mcVersionOf } from './mc-version';
import { isLoaderSource, loaderInstallDescriptor } from './loader-install';
import { desiredGenerationId } from './desired';
import { formatMajorUpdateDiscordMessage } from './format';
import type { ArtifactResolver } from './artifact';
import type { Fetcher, ResolverConfig } from './types';
import type { UpdateSource } from '../schema';

export async function buildMajorDesired(
  source: UpdateSource,
  overall: OverallLatest,
  artifactResolverFor: (s: UpdateSource) => ArtifactResolver | null,
  fetch: Fetcher,
) {
  const resolver = artifactResolverFor(source);
  if (!resolver) return null;
  const artifact = await resolver.resolveArtifact(overall.version, fetch);
  const install = isLoaderSource(source)
    ? loaderInstallDescriptor(source, overall.version, overall.mcVersion)
    : null;
  return {
    id: desiredGenerationId('apply', overall.version),
    version: overall.version,
    artifact,
    install,
    versionLine: overall.mcVersion,
  };
}

export interface DetectMajorOffersDeps {
  dao: {
    loadMajorInputs(): Promise<Array<{
      serverId: string; name: string; source: UpdateSource;
      config: ResolverConfig; installed: string | null; versionLine: string | null;
      majorPolicy: 'notify' | 'approve' | 'auto'; currentDesiredVersion: string | null;
      notifiedMajor: string | null; webhookUrl: string | null;
    }>>;
    writeAvailableMajor(serverId: string, generation: string | null): Promise<void>;
    markNotifiedMajor(serverId: string, generation: string): Promise<void>;
    advanceMajor(serverId: string, d: { versionLine: string; desired: { id: string; version: string; artifact: { url: string; hashAlgo: string; hash: string; size: number }; install: { loader: 'forge' | 'neoforge' | 'fabric'; minecraftVersion: string; loaderVersion: string } | null } }): Promise<void>;
  };
  resolveOverallLatest?: typeof resolveOverallLatest;
  artifactResolverFor: (source: UpdateSource) => ArtifactResolver | null;
  postDiscord: (url: string, payload: { content: string }) => Promise<{ status: number }>;
  sourceLabels: Record<string, string>;
  onError?: (serverId: string, err: unknown) => void;
}

export async function detectMajorOffers(deps: DetectMajorOffersDeps): Promise<void> {
  const resolveOverall = deps.resolveOverallLatest ?? resolveOverallLatest;
  const inputs = await deps.dao.loadMajorInputs();
  for (const input of inputs) {
    try {
      const installedMc = input.installed ? mcVersionOf(input.source, input.installed, input.versionLine) : null;
      const overall = await resolveOverall(input.source, { ...input.config, id: null }, globalThis.fetch as never);
      const plan = planMajorOffer({
        majorPolicy: input.majorPolicy,
        installedMc,
        overall,
        currentDesiredVersion: input.currentDesiredVersion,
        notifiedMajor: input.notifiedMajor,
      });

      if (plan.kind === 'none') {
        await deps.dao.writeAvailableMajor(input.serverId, null);
        continue;
      }

      const og = generationOf(plan.overall.mcVersion)!;

      if (plan.kind === 'auto') {
        const desired = await buildMajorDesired(input.source, plan.overall, deps.artifactResolverFor, globalThis.fetch as never);
        if (!desired) continue;
        await deps.dao.advanceMajor(input.serverId, { versionLine: desired.versionLine, desired });
        continue;
      }

      // offer (approve/notify)
      await deps.dao.writeAvailableMajor(input.serverId, og);
      if (plan.notify && input.webhookUrl) {
        const res = await deps.postDiscord(input.webhookUrl, formatMajorUpdateDiscordMessage({
          serverName: input.name,
          current: input.installed,
          availableMc: plan.overall.mcVersion,
          sourceLabel: deps.sourceLabels[input.source] ?? input.source,
        }));
        if (res.status >= 200 && res.status < 300) await deps.dao.markNotifiedMajor(input.serverId, og);
      }
    } catch (err) {
      deps.onError?.(input.serverId, err);
    }
  }
}
