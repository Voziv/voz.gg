// Cloudflare's "always passes" test secret — used locally when no real secret is set.
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

const SITE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function resolveTurnstileSecret(env: { TURNSTILE_SECRET_KEY?: string }): string {
  return env.TURNSTILE_SECRET_KEY || TURNSTILE_TEST_SECRET;
}

export async function verifyTurnstile(
  token: string,
  secret: string,
  options: { remoteIp?: string; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  if (!token) return false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (options.remoteIp) body.set('remoteip', options.remoteIp);

  const response = await fetchImpl(SITE_VERIFY_URL, { method: 'POST', body });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}
