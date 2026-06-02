import { describe, it, expect } from 'vitest';
import { isAdmin, isOwner } from './admin';

describe('isAdmin', () => {
  it('is true for role "admin"', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
  });
  it('is true for role "owner"', () => {
    expect(isAdmin({ role: 'owner' })).toBe(true);
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

describe('isOwner', () => {
  it('is true only for role "owner"', () => {
    expect(isOwner({ role: 'owner' })).toBe(true);
    expect(isOwner({ role: 'admin' })).toBe(false);
    expect(isOwner(null)).toBe(false);
  });
});
