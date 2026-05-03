'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '@/db';
import { servers, GAME_TYPES } from '@/db/schema';
import { requireAdmin } from '@/lib/auth';

const serverSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  gameType: z.enum(GAME_TYPES),
  host: z
    .string()
    .trim()
    .min(1, 'Host is required.')
    .max(253)
    .regex(/^[A-Za-z0-9.\-_:]+$/, 'Invalid host.'),
  port: z.coerce.number().int().min(1).max(65535),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function parseFormData(formData: FormData) {
  return serverSchema.safeParse({
    name: formData.get('name'),
    gameType: formData.get('gameType'),
    host: formData.get('host'),
    port: formData.get('port'),
    description: formData.get('description'),
  });
}

export async function createServer(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const now = Date.now();
  db.insert(servers)
    .values({
      id: nanoid(12),
      name: parsed.data.name,
      gameType: parsed.data.gameType,
      host: parsed.data.host,
      port: parsed.data.port,
      description: parsed.data.description,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/servers');
  return { ok: true, message: `Server ${parsed.data.name} created.` };
}

export async function updateServer(
  id: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  db.update(servers)
    .set({ ...parsed.data, updatedAt: Date.now() })
    .where(eq(servers.id, id))
    .run();
  revalidatePath('/dashboard/servers');
  return { ok: true, message: 'Server updated.' };
}

export async function deleteServer(id: string): Promise<ActionResult> {
  await requireAdmin();
  db.delete(servers).where(eq(servers.id, id)).run();
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/servers');
  return { ok: true, message: 'Server deleted.' };
}
