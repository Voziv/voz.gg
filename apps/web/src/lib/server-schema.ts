import { z } from 'zod';
import { GAME_TYPES, UPDATE_SOURCES, MODPACK_PROVIDERS, UPDATE_POLICIES } from '@voz/shared';

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
  serverControlEnabled: z
    .boolean()
    .optional()
    .transform((v) => v ?? null),
  serverWorkingDir: z
    .string()
    .trim()
    .max(4096)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || v.startsWith('/'), 'Working directory must be absolute.'),
  startCommand: z
    .string()
    .trim()
    .max(1024)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || v.startsWith('/'), 'Start command must be an absolute path (e.g. /home/minecraft/server/run.sh nogui).'),
  restartSchedule: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), 'Restart time must be UTC HH:MM.'),
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
  updateSource: z.enum(UPDATE_SOURCES).optional().default('none'),
  modpackProvider: z.enum(MODPACK_PROVIDERS).nullish().transform((v) => v ?? null),
  modpackId: z.string().trim().nullish().transform((v) => (v && v.length > 0 ? v : null)),
  updateChannel: z.string().trim().nullish().transform((v) => (v && v.length > 0 ? v : null)),
  pinnedVersion: z.string().trim().nullish().transform((v) => (v && v.length > 0 ? v : null)),
  updatePolicy: z.enum(UPDATE_POLICIES).optional().default('notify'),
  currentVersion: z.string().trim().nullish().transform((v) => (v && v.length > 0 ? v : null)),
}).superRefine((data, ctx) => {
  if (data.serverControlEnabled) {
    for (const [field, value] of [
      ['gameServerUser', data.gameServerUser],
      ['serverWorkingDir', data.serverWorkingDir],
      ['startCommand', data.startCommand],
    ] as const) {
      if (!value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'Required when server management is enabled.',
        });
      }
    }
  }
  if (data.updateSource === 'modpack') {
    if (!data.modpackProvider) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modpackProvider'], message: 'Choose a modpack provider.' });
    if (!data.modpackId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modpackId'], message: 'A modpack id or pack.toml URL is required.' });
  }
});

export type ServerInput = z.infer<typeof serverSchema>;

export type ParseResult =
  | { ok: true; data: ServerInput }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

export function parseServerInput(raw: unknown): ParseResult {
  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !(key in fieldErrors)) {
        fieldErrors[key] = issue.message;
      }
    }
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.', fieldErrors };
  }
  return { ok: true, data: parsed.data };
}
