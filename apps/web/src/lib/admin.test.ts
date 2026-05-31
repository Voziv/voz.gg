import { describe, it, expect } from 'vitest';
import { isAdmin } from './admin';

describe('isAdmin', () => {
  it('is true only for role "admin"', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
  });
  it('is false for a normal user', () => {
    expect(isAdmin({ role: 'user' })).toBe(false);
  });
  it('is false when role is missing/null', () => {
    expect(isAdmin({})).toBe(false);
    expect(isAdmin({ role: null })).toBe(false);
  });
  it('is false for null/undefined', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});
