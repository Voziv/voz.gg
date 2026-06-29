import type { Fetcher } from '../types';
import type { ArtifactResolver, ResolvedArtifact } from '../artifact';
import { resolveInstaller } from './installer-artifact-util';

export const neoforgeArtifactResolver: ArtifactResolver = {
  async resolveArtifact(version: string, fetch: Fetcher): Promise<ResolvedArtifact> {
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
    return resolveInstaller(url, 'sha256', fetch);
  },
};
