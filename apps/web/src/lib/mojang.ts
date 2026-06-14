const MOJANG_RE = /^[A-Za-z0-9_]{3,16}$/;
const UNDASHED_UUID_RE = /^[0-9a-f]{32}$/i;

// We resolve usernames through PlayerDB rather than calling api.mojang.com
// directly: Mojang (behind Azure Front Door) hard-blocks Cloudflare's Worker
// egress with HTTP 403, so a direct call always fails from this Worker even
// though it succeeds from a browser. PlayerDB is a Cloudflare-fronted mirror of
// the same Mojang data and is reachable from Workers. It asks callers to send a
// descriptive User-Agent (Workers send none by default).
const LOOKUP_ENDPOINT = 'https://playerdb.co/api/player/minecraft/';
const USER_AGENT = 'voz.gg (+https://voz.gg)';

// PlayerDB signals "no such player" with HTTP 400 + this code. Detecting it
// specifically (rather than treating every 400 as not-found) keeps a genuine
// upstream failure from masquerading as a missing user.
const NOT_FOUND_CODE = 'minecraft.invalid_username';

export type MojangProfile = { uuid: string; name: string };

// Distinguish "this username genuinely does not exist" (not_found) from "we
// could not reach the lookup service" (error). Collapsing both into null
// previously made an upstream block look identical to a typo, and hid the
// failure from callers and logs.
export type MojangLookup =
  | { kind: 'found'; profile: MojangProfile }
  | { kind: 'not_found' }
  | { kind: 'error'; status?: number };

type PlayerDbResponse = {
  code?: string;
  data?: { player?: { username?: string; raw_id?: string } };
};

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
  const url = `${LOOKUP_ENDPOINT}${encodeURIComponent(username)}`;
  try {
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });

    if (res.ok) {
      const json = (await res.json()) as PlayerDbResponse;
      const rawId = json.data?.player?.raw_id;
      const name = json.data?.player?.username;
      if (!rawId || !UNDASHED_UUID_RE.test(rawId) || !name) {
        console.warn(`minecraft lookup for "${username}" returned an unexpected payload`);
        return { kind: 'error' };
      }
      return { kind: 'found', profile: { uuid: dashUuid(rawId.toLowerCase()), name } };
    }

    if (res.status === 404) return { kind: 'not_found' };
    if (res.status === 400) {
      const json = (await res.json().catch(() => null)) as PlayerDbResponse | null;
      if (json?.code === NOT_FOUND_CODE) return { kind: 'not_found' };
    }

    console.warn(`minecraft lookup failed for "${username}": HTTP ${res.status}`);
    return { kind: 'error', status: res.status };
  } catch (error) {
    console.warn(`minecraft lookup for "${username}" threw:`, error);
    return { kind: 'error' };
  }
}
