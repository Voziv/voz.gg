import { z } from 'zod';
import { GAME_TYPES } from '@voz/shared';

const serverSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  gameType: z.enum(GAME_TYPES),
  host: z
    .string()
    .trim()
    .min(1, 'Host is required.')
    .max(253)
    .regex(/^[A-Za-z0-9.\-_]+$/, 'Invalid host.'),
  port: z.coerce.number().int().min(1).max(65535),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type ServerInput = z.infer<typeof serverSchema>;

export type ParseResult =
  | { ok: true; data: ServerInput }
  | { ok: false; error: string };

export function parseServerInput(raw: unknown): ParseResult {
  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  return { ok: true, data: parsed.data };
}
