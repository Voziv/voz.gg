const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const STEAM_LOGIN = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export type SteamVerifyResult = { ok: true; steamId64: string } | { ok: false; reason: string };

export function buildSteamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  });
  return `${STEAM_LOGIN}?${params.toString()}`;
}

export function parseSteamId64(claimedId: string | null): string | null {
  if (!claimedId) return null;
  const match = CLAIMED_ID_RE.exec(claimedId);
  return match ? match[1] : null;
}

export async function verifySteamAssertion(
  params: URLSearchParams,
  fetchFn: typeof fetch = fetch,
): Promise<SteamVerifyResult> {
  if (params.get('openid.mode') !== 'id_res') {
    return { ok: false, reason: 'mode is not id_res' };
  }
  const steamId64 = parseSteamId64(params.get('openid.claimed_id'));
  if (!steamId64) {
    return { ok: false, reason: 'malformed claimed_id' };
  }

  const verifyBody = new URLSearchParams(params);
  verifyBody.set('openid.mode', 'check_authentication');

  const response = await fetchFn(STEAM_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verifyBody.toString(),
  });
  const text = await response.text();
  if (!/is_valid:true/.test(text)) {
    return { ok: false, reason: 'Steam did not confirm the assertion' };
  }
  return { ok: true, steamId64 };
}
