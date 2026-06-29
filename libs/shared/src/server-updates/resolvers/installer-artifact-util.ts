import type { Fetcher } from '../types';
import type { HashAlgo } from '../../schema';
import type { ResolvedArtifact } from '../artifact';

const UA = { 'User-Agent': 'voz.gg-update-checker' };

// Resolve a Maven-hosted installer: read the sibling checksum file (raw hex,
// possibly newline-terminated) and the artifact's Content-Length for size.
export async function resolveInstaller(url: string, hashAlgo: HashAlgo, fetch: Fetcher): Promise<ResolvedArtifact> {
  const hashRes = await fetch(`${url}.${hashAlgo}`, { headers: UA });
  if (!hashRes.ok) throw new Error(`installer ${hashAlgo} fetch failed: ${hashRes.status}`);
  const hash = (await hashRes.text()).trim().split(/\s+/)[0];
  if (!hash) throw new Error(`empty ${hashAlgo} for ${url}`);

  const headRes = await fetch(url, { method: 'HEAD', headers: UA });
  if (!headRes.ok) throw new Error(`installer HEAD failed: ${headRes.status}`);
  const size = Number(headRes.headers?.get('content-length') ?? 0);
  return { url, hashAlgo, hash, size };
}
