import { describe, it, expect } from 'vitest';
import { resolveFromAddress } from './email';

describe('resolveFromAddress', () => {
  it('returns the configured FROM_EMAIL', () => {
    expect(resolveFromAddress({ FROM_EMAIL: 'voz.gg <noreply@mail.voz.gg>' })).toBe('voz.gg <noreply@mail.voz.gg>');
  });
  it('throws when FROM_EMAIL is unset', () => {
    expect(() => resolveFromAddress({})).toThrow(/FROM_EMAIL/);
  });
});
