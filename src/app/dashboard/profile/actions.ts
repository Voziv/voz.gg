'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { lookupMinecraftProfile } from '@/lib/mojang';

const profileSchema = z.object({
  displayName: z.string().trim().max(80).nullish().transform((v) => v || null),
  bio: z.string().trim().max(500).nullish().transform((v) => v || null),
});

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export async function updateProfile(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { user } = await requireUser();
  const parsed = profileSchema.safeParse({
    displayName: formData.get('displayName'),
    bio: formData.get('bio'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input.' };
  }
  db.update(users)
    .set({
      displayName: parsed.data.displayName,
      bio: parsed.data.bio,
      updatedAt: Date.now(),
    })
    .where(eq(users.id, user.id))
    .run();

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/profile');
  return { ok: true, message: 'Profile saved.' };
}

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(16)
  .regex(/^[A-Za-z0-9_]+$/, 'Letters, numbers, and underscores only.');

export async function lookupMinecraftAction(
  username: string,
): Promise<{ ok: true; uuid: string; name: string } | { ok: false; error: string }> {
  await requireUser();
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) return { ok: false, error: 'Invalid format.' };
  const profile = await lookupMinecraftProfile(parsed.data);
  if (!profile) return { ok: false, error: 'No such Minecraft account.' };
  return { ok: true, uuid: profile.uuid, name: profile.name };
}

export async function setMinecraftUsername(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { user } = await requireUser();
  const raw = (formData.get('username') ?? '').toString();
  if (raw === '') {
    db.update(users)
      .set({ minecraftUuid: null, minecraftName: null, updatedAt: Date.now() })
      .where(eq(users.id, user.id))
      .run();
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/profile');
    return { ok: true, message: 'Minecraft username cleared.' };
  }
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid format.' };
  }
  const profile = await lookupMinecraftProfile(parsed.data);
  if (!profile) {
    return { ok: false, error: 'No such Minecraft account.' };
  }
  db.update(users)
    .set({
      minecraftUuid: profile.uuid,
      minecraftName: profile.name,
      updatedAt: Date.now(),
    })
    .where(eq(users.id, user.id))
    .run();
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/profile');
  return { ok: true, message: `Linked Minecraft account ${profile.name}.` };
}

export async function unlinkSteam(): Promise<ActionResult> {
  const { user } = await requireUser();
  db.update(users)
    .set({
      steamId64: null,
      steamPersona: null,
      steamAvatar: null,
      updatedAt: Date.now(),
    })
    .where(eq(users.id, user.id))
    .run();
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/profile');
  return { ok: true, message: 'Steam unlinked.' };
}
