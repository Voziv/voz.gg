import 'server-only';

export type SteamSummary = {
  personaName: string;
  avatarUrl: string;
  profileUrl: string;
};

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: SteamSummary | null; expiresAt: number }>();

export async function fetchSteamSummary(steamId64: string): Promise<SteamSummary | null> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) return null;

  const cached = cache.get(steamId64);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamids', steamId64);

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      cache.set(steamId64, { value: null, expiresAt: Date.now() + TTL_MS });
      return null;
    }
    const json = (await res.json()) as {
      response?: { players?: Array<{ personaname?: string; avatarfull?: string; profileurl?: string }> };
    };
    const player = json.response?.players?.[0];
    if (!player?.personaname) {
      cache.set(steamId64, { value: null, expiresAt: Date.now() + TTL_MS });
      return null;
    }
    const value: SteamSummary = {
      personaName: player.personaname,
      avatarUrl: player.avatarfull ?? '',
      profileUrl: player.profileurl ?? `https://steamcommunity.com/profiles/${steamId64}/`,
    };
    cache.set(steamId64, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch {
    return null;
  }
}
