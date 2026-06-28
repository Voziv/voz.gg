import type { Fetcher } from './types';
import type { HashAlgo, UpdateSource } from '../schema';
import { vanillaArtifactResolver } from './resolvers/vanilla-artifact';

export interface ResolvedArtifact {
  url: string;
  hashAlgo: HashAlgo;
  hash: string;
  size: number;
}

export interface ArtifactResolver {
  resolveArtifact(version: string, fetch: Fetcher): Promise<ResolvedArtifact>;
}

// Vanilla is the only applyable source in this sub-project; loaders/modpacks
// return null so the Worker never produces a desired release the agent cannot
// install.
export function artifactResolverFor(source: UpdateSource): ArtifactResolver | null {
  return source === 'vanilla' ? vanillaArtifactResolver : null;
}
