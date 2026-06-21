import { z } from 'zod';
import { PLAYER_STATUSES, PLAYER_IDENTITY_KINDS } from './schema';
import type { PlayerStatus, PlayerIdentityKind } from './schema';

export type MutationResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

export interface PlayerCore {
  id: string;
  displayName: string | null;
  notes: string | null;
  status: PlayerStatus;
  isBot: boolean;
  muted: boolean;
  userId: string | null;
}

export interface PlayerSearchResult {
  id: string;
  displayName: string | null;
  minecraftName: string | null;
}

export type PlayerFieldsUpdate = {
  displayName?: string | null;
  status?: PlayerStatus;
  isBot?: boolean;
  muted?: boolean;
  notes?: string | null;
};

const blankToNull = (v: string | null | undefined) => {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
};

// No .strict(): the repo's Zod setup doesn't use it. Unknown keys are stripped by
// default, so a body with only unrecognized fields yields an empty update and is
// rejected by the "No fields to update" guard below.
const playerFieldsSchema = z.object({
  displayName: z.string().max(120).nullable().optional(),
  status: z.enum(PLAYER_STATUSES).optional(),
  isBot: z.boolean().optional(),
  muted: z.boolean().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});

export function parsePlayerFieldsInput(
  raw: unknown,
): { ok: true; data: PlayerFieldsUpdate } | { ok: false; error: string } {
  const parsed = playerFieldsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Invalid player fields.' };
  const out: PlayerFieldsUpdate = {};
  if ('displayName' in parsed.data) out.displayName = blankToNull(parsed.data.displayName);
  if ('status' in parsed.data) out.status = parsed.data.status;
  if ('isBot' in parsed.data) out.isBot = parsed.data.isBot;
  if ('muted' in parsed.data) out.muted = parsed.data.muted;
  if ('notes' in parsed.data) out.notes = blankToNull(parsed.data.notes);
  if (Object.keys(out).length === 0) return { ok: false, error: 'No fields to update.' };
  return { ok: true, data: out };
}

// Trim ends and collapse internal whitespace runs; null when nothing remains.
// Case is preserved for display; uniqueness is matched case-insensitively in the DAO.
export function normalizeGroupName(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, ' ');
  return t.length ? t : null;
}

export interface MergeCombine {
  notes: string | null;
  isBot: boolean;
  userId: string | null;
}

export type MergeComputation =
  | { ok: true; combine: MergeCombine }
  | { ok: false; reason: 'account-conflict' };

export function computeMergeResult(survivor: PlayerCore, absorbed: PlayerCore): MergeComputation {
  if (survivor.userId && absorbed.userId && survivor.userId !== absorbed.userId) {
    return { ok: false, reason: 'account-conflict' };
  }
  const notes =
    [survivor.notes, absorbed.notes]
      .map((n) => n?.trim())
      .filter((n): n is string => !!n && n.length > 0)
      .join('\n\n') || null;
  return {
    ok: true,
    combine: { notes, isBot: survivor.isBot || absorbed.isBot, userId: survivor.userId ?? absorbed.userId },
  };
}

export interface PlayerMutationsDao {
  getPlayer(id: string): Promise<PlayerCore | null>;
  updatePlayer(id: string, fields: PlayerFieldsUpdate & { userId?: string | null }, now: Date): Promise<void>;
  /** Case-insensitive lookup by display name. */
  findGroupByName(name: string): Promise<{ id: string } | null>;
  createGroupTag(name: string, now: Date): Promise<string>;
  attachGroup(playerId: string, groupTagId: string): Promise<void>;
  detachGroup(playerId: string, groupTagId: string): Promise<void>;
  findIdentity(kind: PlayerIdentityKind, key: string): Promise<{ playerId: string } | null>;
  addIdentity(playerId: string, kind: PlayerIdentityKind, key: string, now: Date): Promise<void>;
  removeIdentity(playerId: string, kind: PlayerIdentityKind, key: string): Promise<boolean>;
  repointIdentities(fromPlayerId: string, toPlayerId: string): Promise<void>;
  unionGroups(fromPlayerId: string, toPlayerId: string): Promise<void>;
  deletePlayer(id: string): Promise<void>;
  searchPlayers(query: string, limit: number): Promise<PlayerSearchResult[]>;
}

function fail<T = Record<never, never>>(status: number, error: string): MutationResult<T> {
  return { ok: false, status, error };
}

function isIdentityKind(v: unknown): v is PlayerIdentityKind {
  return typeof v === 'string' && (PLAYER_IDENTITY_KINDS as readonly string[]).includes(v);
}

export async function handleUpdatePlayerFields(
  dao: PlayerMutationsDao,
  id: string,
  rawBody: unknown,
  now: Date,
): Promise<MutationResult> {
  const parsed = parsePlayerFieldsInput(rawBody);
  if (!parsed.ok) return fail(400, parsed.error);
  if (!(await dao.getPlayer(id))) return fail(404, 'Player not found.');
  await dao.updatePlayer(id, parsed.data, now);
  return { ok: true };
}

export async function handleAddGroup(
  dao: PlayerMutationsDao,
  playerId: string,
  rawName: string,
  now: Date,
): Promise<MutationResult> {
  const name = normalizeGroupName(rawName);
  if (!name) return fail(400, 'Group name is required.');
  if (!(await dao.getPlayer(playerId))) return fail(404, 'Player not found.');
  const existing = await dao.findGroupByName(name);
  const groupTagId = existing?.id ?? (await dao.createGroupTag(name, now));
  await dao.attachGroup(playerId, groupTagId);
  return { ok: true };
}

export async function handleRemoveGroup(
  dao: PlayerMutationsDao,
  playerId: string,
  rawName: string,
): Promise<MutationResult> {
  const name = normalizeGroupName(rawName);
  if (!name) return fail(400, 'Group name is required.');
  const group = await dao.findGroupByName(name);
  // Intentionally idempotent: ok even if the player isn't a member or the group
  // doesn't exist, unlike handleRemoveIdentity which 404s on a missing identity.
  if (group) await dao.detachGroup(playerId, group.id);
  return { ok: true };
}

export async function handleAddIdentity(
  dao: PlayerMutationsDao,
  playerId: string,
  rawKind: unknown,
  rawKey: unknown,
  now: Date,
): Promise<MutationResult> {
  if (!isIdentityKind(rawKind)) return fail(400, 'Invalid identity kind.');
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!key) return fail(400, 'Identity key is required.');
  if (!(await dao.getPlayer(playerId))) return fail(404, 'Player not found.');
  const owner = await dao.findIdentity(rawKind, key);
  if (owner && owner.playerId !== playerId) return fail(409, 'Identity already belongs to another player.');
  if (!owner) await dao.addIdentity(playerId, rawKind, key, now);
  return { ok: true };
}

export async function handleRemoveIdentity(
  dao: PlayerMutationsDao,
  playerId: string,
  rawKind: unknown,
  rawKey: unknown,
): Promise<MutationResult> {
  if (!isIdentityKind(rawKind)) return fail(400, 'Invalid identity kind.');
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!key) return fail(400, 'Identity key is required.');
  const removed = await dao.removeIdentity(playerId, rawKind, key);
  if (!removed) return fail(404, 'Identity not found for this player.');
  return { ok: true };
}

export async function handleMergePlayers(
  dao: PlayerMutationsDao,
  survivorId: string,
  absorbedId: string,
  now: Date,
): Promise<MutationResult> {
  if (!absorbedId || absorbedId === survivorId) return fail(400, 'Cannot merge a player into itself.');
  const survivor = await dao.getPlayer(survivorId);
  const absorbed = await dao.getPlayer(absorbedId);
  if (!survivor || !absorbed) return fail(404, 'Player not found.');

  const computed = computeMergeResult(survivor, absorbed);
  if (!computed.ok) return fail(409, 'Both players are linked to different accounts; resolve the link first.');

  // Re-point children BEFORE deleting the absorbed row (FK cascade would drop them).
  // The four writes are not wrapped in a transaction (consistent with the codebase's
  // non-transactional D1 pattern in presence-dao.ts); a mid-sequence failure could
  // leave a partial merge.
  await dao.repointIdentities(absorbedId, survivorId);
  await dao.unionGroups(absorbedId, survivorId);
  await dao.updatePlayer(survivorId, computed.combine, now);
  await dao.deletePlayer(absorbedId);
  return { ok: true };
}

export async function handleSearchPlayers(
  dao: PlayerMutationsDao,
  rawQuery: string,
): Promise<MutationResult<{ players: PlayerSearchResult[] }>> {
  const q = (rawQuery ?? '').trim();
  if (q.length < 1) return fail(400, 'Query is required.');
  const players = await dao.searchPlayers(q, 20);
  return { ok: true, players };
}
