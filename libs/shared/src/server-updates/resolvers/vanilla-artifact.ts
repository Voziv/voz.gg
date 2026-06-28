import type { Fetcher } from '../types';
import type { ArtifactResolver, ResolvedArtifact } from '../artifact';

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

interface Manifest {
  versions: { id: string; url: string }[];
}
interface Package {
  downloads: { server?: { url: string; sha1: string; size: number } };
}

export const vanillaArtifactResolver: ArtifactResolver = {
  async resolveArtifact(version: string, fetch: Fetcher): Promise<ResolvedArtifact> {
    const manifestRes = await fetch(MANIFEST_URL, { headers: { 'User-Agent': 'voz.gg-update-checker' } });
    if (!manifestRes.ok) throw new Error(`vanilla manifest fetch failed: ${manifestRes.status}`);
    const manifest = (await manifestRes.json()) as Manifest;
    const entry = manifest.versions.find((v) => v.id === version);
    if (!entry) throw new Error(`vanilla version ${version} not found in manifest`);

    const pkgRes = await fetch(entry.url, { headers: { 'User-Agent': 'voz.gg-update-checker' } });
    if (!pkgRes.ok) throw new Error(`vanilla package fetch failed: ${pkgRes.status}`);
    const pkg = (await pkgRes.json()) as Package;
    const server = pkg.downloads.server;
    if (!server) throw new Error(`vanilla version ${version} has no server download`);
    return { url: server.url, hashAlgo: 'sha1', hash: server.sha1, size: server.size };
  },
};
