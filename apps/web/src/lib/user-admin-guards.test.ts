import { describe, it, expect } from 'vitest';
import { canActOnTarget, canSetRole, canTransferOwnership } from './user-admin-guards';

const ctx = (over: Partial<Parameters<typeof canActOnTarget>[0]> = {}) => ({
  actorRole: 'admin' as const,
  actorId: 'a',
  targetRole: 'user' as const,
  targetId: 't',
  ...over,
});

describe('canActOnTarget', () => {
  it('lets an admin ban a regular user', () => {
    expect(canActOnTarget(ctx(), 'ban').ok).toBe(true);
  });
  it('lets an owner delete an admin', () => {
    expect(canActOnTarget(ctx({ actorRole: 'owner', targetRole: 'admin' }), 'delete').ok).toBe(true);
  });
  it('blocks acting on the owner (locked) for everyone', () => {
    const r = canActOnTarget(ctx({ actorRole: 'owner', targetRole: 'owner', targetId: 'a', actorId: 'a' }), 'ban');
    expect(r.ok).toBe(false);
  });
  it('blocks an admin from acting on another admin', () => {
    const r = canActOnTarget(ctx({ targetRole: 'admin' }), 'delete');
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  it('blocks self-ban and self-delete', () => {
    expect(canActOnTarget(ctx({ targetId: 'a' }), 'ban').ok).toBe(false);
    expect(canActOnTarget(ctx({ targetId: 'a' }), 'delete').ok).toBe(false);
  });
  it('rejects a non-admin actor', () => {
    expect(canActOnTarget(ctx({ actorRole: 'user' }), 'ban').ok).toBe(false);
  });
});

describe('canSetRole', () => {
  it('lets the owner set a user to admin', () => {
    expect(canSetRole(ctx({ actorRole: 'owner' }), 'admin').ok).toBe(true);
  });
  it('forbids a regular admin from setting any role', () => {
    expect(canSetRole(ctx(), 'admin')).toMatchObject({ ok: false, status: 403 });
  });
  it('forbids setting role to owner (transfer-only)', () => {
    expect(canSetRole(ctx({ actorRole: 'owner' }), 'owner').ok).toBe(false);
  });
  it('forbids the owner setting their own role', () => {
    expect(canSetRole(ctx({ actorRole: 'owner', targetId: 'a' }), 'admin').ok).toBe(false);
  });
  it('rejects an unknown role value', () => {
    expect(canSetRole(ctx({ actorRole: 'owner' }), 'superuser').ok).toBe(false);
  });
});

describe('canTransferOwnership', () => {
  it('lets the owner transfer to an admin', () => {
    expect(canTransferOwnership(ctx({ actorRole: 'owner', targetRole: 'admin' })).ok).toBe(true);
  });
  it('lets the owner transfer to a regular user', () => {
    expect(canTransferOwnership(ctx({ actorRole: 'owner', targetRole: 'user' })).ok).toBe(true);
  });
  it('forbids a non-owner from transferring', () => {
    expect(canTransferOwnership(ctx({ actorRole: 'admin', targetRole: 'user' })).ok).toBe(false);
  });
  it('forbids transferring to self', () => {
    expect(canTransferOwnership(ctx({ actorRole: 'owner', targetId: 'a' })).ok).toBe(false);
  });
});
