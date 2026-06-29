import type { Fetcher } from './types';
import type { HashAlgo, UpdateSource } from '../schema';
import { vanillaArtifactResolver } from './resolvers/vanilla-artifact';
import { neoforgeArtifactResolver } from './resolvers/neoforge-artifact';
import { forgeArtifactResolver } from './resolvers/forge-artifact';
import { fabricArtifactResolver } from './resolvers/fabric-artifact';

export interface ResolvedArtifact {
  url: string;
  hashAlgo: HashAlgo;
  hash: string;
  size: number;
}

export interface ArtifactResolver {
  resolveArtifact(version: string, fetch: Fetcher): Promise<ResolvedArtifact>;
}

// Loaders are applyable via their installer jars (sub-project 3); modpacks still
// return null so the Worker never produces a desired the agent cannot install.
export function artifactResolverFor(source: UpdateSource): ArtifactResolver | null {
  switch (source) {
    case 'vanilla': return vanillaArtifactResolver;
    case 'neoforge': return neoforgeArtifactResolver;
    case 'forge': return forgeArtifactResolver;
    case 'fabric': return fabricArtifactResolver;
    default: return null;
  }
}
