import { describe, it, expect } from 'vitest';
import { resolveSiteKey, TURNSTILE_TEST_KEY, TURNSTILE_PROD_KEY } from './turnstile-site-key';

describe('resolveSiteKey', () => {
  it('prefers the explicit env key', () => {
    expect(resolveSiteKey({ hostname: 'voz.gg', envKey: 'override' })).toBe('override');
  });
  it('uses the test key on localhost', () => {
    expect(resolveSiteKey({ hostname: 'localhost' })).toBe(TURNSTILE_TEST_KEY);
    expect(resolveSiteKey({ hostname: '127.0.0.1' })).toBe(TURNSTILE_TEST_KEY);
  });
  it('uses the prod key elsewhere', () => {
    expect(resolveSiteKey({ hostname: 'voz.gg' })).toBe(TURNSTILE_PROD_KEY);
  });
});
