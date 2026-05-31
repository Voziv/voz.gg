import { describe, it, expect } from 'vitest';
import { resolveMode, resolveInitialMode } from './theme';

describe('resolveMode', () => {
  it('returns the explicit mode regardless of OS preference', () => {
    expect(resolveMode('dark', false)).toBe('dark');
    expect(resolveMode('light', true)).toBe('light');
  });
  it('follows the OS preference in system mode', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
  });
});

describe('resolveInitialMode', () => {
  it('prefers a valid profile theme over a stored theme', () => {
    expect(resolveInitialMode({ profileTheme: 'light', storedTheme: 'dark' })).toBe('light');
  });
  it('falls back to the stored theme when the profile theme is null', () => {
    expect(resolveInitialMode({ profileTheme: null, storedTheme: 'dark' })).toBe('dark');
  });
  it('falls back to the stored theme when the profile theme is invalid', () => {
    expect(resolveInitialMode({ profileTheme: 'neon', storedTheme: 'light' })).toBe('light');
  });
  it('falls back to system when neither is a valid mode', () => {
    expect(resolveInitialMode({ profileTheme: null, storedTheme: null })).toBe('system');
    expect(resolveInitialMode({ profileTheme: 'bogus', storedTheme: 'bogus' })).toBe('system');
  });
});
