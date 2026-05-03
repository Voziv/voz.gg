import 'server-only';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

function getRealm(): string {
  return (
    process.env.STEAM_REALM ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  );
}

function getReturnUrl(): string {
  return (
    process.env.STEAM_RETURN_URL ?? `${getRealm()}/api/auth/steam/callback`
  );
}

export function buildSteamLoginUrl(): string {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': getReturnUrl(),
    'openid.realm': getRealm(),
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

export type SteamVerifyResult =
  | { ok: true; steamId64: string }
  | { ok: false; reason: string };

const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export async function verifySteamOpenIdResponse(
  searchParams: URLSearchParams,
): Promise<SteamVerifyResult> {
  if (searchParams.get('openid.mode') !== 'id_res') {
    return { ok: false, reason: 'invalid_mode' };
  }
  const claimedId = searchParams.get('openid.claimed_id') ?? '';
  const match = CLAIMED_ID_RE.exec(claimedId);
  if (!match) {
    return { ok: false, reason: 'invalid_claimed_id' };
  }

  const verify = new URLSearchParams(searchParams);
  verify.set('openid.mode', 'check_authentication');

  const res = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    body: verify,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, reason: 'verify_request_failed' };

  const body = await res.text();
  const isValid = /is_valid\s*:\s*true/i.test(body);
  if (!isValid) return { ok: false, reason: 'is_valid_false' };

  return { ok: true, steamId64: match[1] };
}
