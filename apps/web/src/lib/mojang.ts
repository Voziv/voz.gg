const MOJANG_RE = /^[A-Za-z0-9_]{3,16}$/;

// Cloudflare Workers send no User-Agent by default. Some upstreams (Mojang sits
// behind Azure Front Door) treat empty-agent / shared-egress requests harshly,
// so identify ourselves explicitly.
const USER_AGENT = 'voz.gg (+https://voz.gg)';

export type MojangProfile = { uuid: string; name: string };

// Distinguish "this username genuinely does not exist" (not_found) from "we
// could not reach Mojang" (error). Collapsing both into null previously made an
// upstream block look identical to a typo, and hid the failure from callers and
// logs.
export type MojangLookup =
  | { kind: 'found'; profile: MojangProfile }
  | { kind: 'not_found' }
  | { kind: 'error'; status?: number };

export function isValidMinecraftUsernameSyntax(name: string): boolean {
  return MOJANG_RE.test(name);
}

function dashUuid(undashed: string): string {
  return [
    undashed.slice(0, 8),
    undashed.slice(8, 12),
    undashed.slice(12, 16),
    undashed.slice(16, 20),
    undashed.slice(20),
  ].join('-');
}

export async function lookupMinecraftProfile(
  username: string,
  fetchFn: typeof fetch = fetch,
): Promise<MojangLookup> {
  if (!isValidMinecraftUsernameSyntax(username)) return { kind: 'not_found' };
  const url = `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`;
  try {
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (res.status === 404 || res.status === 204) return { kind: 'not_found' };
    if (!res.ok) {
      console.warn(`mojang lookup failed for "${username}": HTTP ${res.status}`);
      return { kind: 'error', status: res.status };
    }
    const json = (await res.json()) as { id?: string; name?: string };
    if (!json.id || !json.name) {
      console.warn(`mojang lookup for "${username}" returned an unexpected payload`);
      return { kind: 'error' };
    }
    return { kind: 'found', profile: { uuid: dashUuid(json.id), name: json.name } };
  } catch (error) {
    console.warn(`mojang lookup for "${username}" threw:`, error);
    return { kind: 'error' };
  }
}
