import { z } from 'zod';
import { PLAYER_STATUSES, PLAYER_IDENTITY_KINDS } from './schema';
import type { PlayerStatus, PlayerIdentityKind } from './schema';

export type MutationResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

export interface PlayerCore {
  id: string;
  displayName: string | null;
  notes: string | null;
  status: PlayerStatus;
  isBot: boolean;
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
