import { describe, it, expect } from 'vitest';
import { slugifyServerName } from './slug';

describe('slugifyServerName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyServerName('My Server 01')).toBe('my-server-01');
  });
  it('strips invalid characters', () => {
    expect(slugifyServerName('Survival!! (main)')).toBe('survival-main');
  });
  it('collapses and trims hyphens', () => {
    expect(slugifyServerName('  a / b  ')).toBe('a-b');
  });
  it('falls back to "server" when nothing usable remains', () => {
    expect(slugifyServerName('!!!')).toBe('server');
  });
});
