import { describe, it, expect } from 'vitest';
import { canActOnTarget, canSetRole, canTransferOwnership, rowActionAvailability } from './user-admin-guards';

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

describe('rowActionAvailability', () => {
  it('admin viewing own row — all false (self-row issue #43: server blocks self unban/revoke via admin→non-user rule)', () => {
    const a = rowActionAvailability(ctx({ actorRole: 'admin', targetRole: 'admin', targetId: 'a' }));
    expect(a).toEqual({
      ban: false,
      unban: false,
      revokeSessions: false,
      makeAdmin: false,
      demote: false,
      transferOwnership: false,
      delete: false,
      any: false,
    });
  });

  it('admin acting on a regular user — ban/revokeSessions/delete true, role-change/transfer false', () => {
    const a = rowActionAvailability(ctx({ actorRole: 'admin', targetRole: 'user' }));
    expect(a.ban).toBe(true);
    expect(a.revokeSessions).toBe(true);
    expect(a.delete).toBe(true);
    expect(a.makeAdmin).toBe(false);
    expect(a.demote).toBe(false);
    expect(a.transferOwnership).toBe(false);
    expect(a.any).toBe(true);
  });

  it('owner acting on a regular user — ban/revokeSessions/delete/makeAdmin/transferOwnership true, demote false', () => {
    const a = rowActionAvailability(ctx({ actorRole: 'owner', targetRole: 'user' }));
    expect(a.ban).toBe(true);
    expect(a.revokeSessions).toBe(true);
    expect(a.delete).toBe(true);
    expect(a.makeAdmin).toBe(true);
    expect(a.demote).toBe(false);
    expect(a.transferOwnership).toBe(true);
    expect(a.any).toBe(true);
  });

  it('owner acting on an admin — ban/revokeSessions/delete/demote/transferOwnership true, makeAdmin false', () => {
    const a = rowActionAvailability(ctx({ actorRole: 'owner', targetRole: 'admin' }));
    expect(a.ban).toBe(true);
    expect(a.revokeSessions).toBe(true);
    expect(a.delete).toBe(true);
    expect(a.makeAdmin).toBe(false);
    expect(a.demote).toBe(true);
    expect(a.transferOwnership).toBe(true);
    expect(a.any).toBe(true);
  });

  it('anyone acting on an owner target — all false', () => {
    const a = rowActionAvailability(ctx({ actorRole: 'owner', targetRole: 'owner', targetId: 'other' }));
    expect(a).toEqual({
      ban: false,
      unban: false,
      revokeSessions: false,
      makeAdmin: false,
      demote: false,
      transferOwnership: false,
      delete: false,
      any: false,
    });
  });

  it('banned regular-user target — unban true (same guard as ban)', () => {
    // The guard is agnostic to the banned flag; both ban and unban pass when allowed.
    // The UI uses actions.ban vs actions.unban to toggle which button to show.
    const a = rowActionAvailability(ctx({ actorRole: 'admin', targetRole: 'user' }));
    expect(a.unban).toBe(true);
    expect(a.ban).toBe(true);
  });
});
