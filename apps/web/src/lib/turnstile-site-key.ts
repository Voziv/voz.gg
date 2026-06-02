// Public Turnstile site keys (safe to commit). Mirrors the leerobert.ca pattern.
export const TURNSTILE_TEST_KEY = '1x00000000000000000000AA';
export const TURNSTILE_PROD_KEY = '0x4AAAAAADdVDpZvTvq1DVEL';

// Precedence: explicit build-time env override, else the test key on localhost,
// else the production key.
export function resolveSiteKey(opts: { hostname: string; envKey?: string }): string {
  if (opts.envKey) return opts.envKey;
  if (opts.hostname === 'localhost' || opts.hostname === '127.0.0.1') return TURNSTILE_TEST_KEY;
  return TURNSTILE_PROD_KEY;
}
