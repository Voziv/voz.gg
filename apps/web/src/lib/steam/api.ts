const SUMMARIES_URL = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';

export interface SteamSummary {
  personaName: string;
  avatarUrl: string;
  profileUrl: string;
}

export async function fetchSteamSummary(
  steamId64: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<SteamSummary | null> {
  const url = `${SUMMARIES_URL}?key=${apiKey}&steamids=${steamId64}`;
  try {
    const response = await fetchFn(url);
    if (!response.ok) return null;
    const data = (await response.json()) as {
      response?: { players?: Array<{ personaname: string; avatarfull: string; profileurl: string }> };
    };
    const player = data.response?.players?.[0];
    if (!player) return null;
    return { personaName: player.personaname, avatarUrl: player.avatarfull, profileUrl: player.profileurl };
  } catch {
    return null;
  }
}
