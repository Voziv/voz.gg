import type { Fetcher } from '../types';
import type { ArtifactResolver, ResolvedArtifact } from '../artifact';
import { resolveInstaller } from './installer-artifact-util';

export const forgeArtifactResolver: ArtifactResolver = {
  async resolveArtifact(version: string, fetch: Fetcher): Promise<ResolvedArtifact> {
    // version is the detection output "<mc>-<build>" (e.g. 1.21.1-52.1.14).
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-installer.jar`;
    return resolveInstaller(url, 'sha1', fetch);
  },
};
