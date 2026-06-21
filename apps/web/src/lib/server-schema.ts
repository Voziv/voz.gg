import { z } from 'zod';
import { GAME_TYPES } from '@voz/shared';

// A POSIX-ish account/group name, or null when blank. Empty input (the common
// "leave default" case) becomes null so the Worker applies its own defaults.
const optionalUnixName = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine((v) => v === null || /^[a-z_][a-z0-9_-]{0,31}$/.test(v), 'Invalid user or group name.');

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
  runAsUser: optionalUnixName,
  runAsGroup: optionalUnixName,
  gameServerUser: optionalUnixName,
  logPath: z
    .string()
    .trim()
    .max(4096)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || v.startsWith('/'), 'Log path must be absolute.'),
  logParserEnabled: z
    .boolean()
    .optional()
    .transform((v) => v ?? null),
  discordWebhookUrl: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine(
      (v) => v === null || /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(v),
      'Must be a Discord webhook URL.',
    ),
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
