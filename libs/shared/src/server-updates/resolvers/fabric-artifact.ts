import type { Fetcher } from '../types';
import type { ArtifactResolver, ResolvedArtifact } from '../artifact';
import { resolveInstaller } from './installer-artifact-util';

const META_URL = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/maven-metadata.xml';

// Fabric's installer is generic (one jar installs any mc+loader); the agent
// passes mc/loader at run time. The artifact is therefore just the latest
// installer jar — `version` (the loader version) does not affect the URL.
export const fabricArtifactResolver: ArtifactResolver = {
  async resolveArtifact(_version: string, fetch: Fetcher): Promise<ResolvedArtifact> {
    const metaRes = await fetch(META_URL, { headers: { 'User-Agent': 'voz.gg-update-checker' } });
    if (!metaRes.ok) throw new Error(`fabric installer metadata failed: ${metaRes.status}`);
    const release = (await metaRes.text()).match(/<release>([^<]+)<\/release>/)?.[1];
    if (!release) throw new Error('no fabric installer release in metadata');
    const url = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${release}/fabric-installer-${release}.jar`;
    return resolveInstaller(url, 'sha1', fetch);
  },
};
