import { z } from 'zod';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inviteRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  discordName: z.string().trim().min(1, 'Discord name is required.').max(80),
  email: z
    .string()
    .trim()
    .max(254)
    .regex(EMAIL_RE, 'A valid email is required.')
    .transform((value) => value.toLowerCase()),
});

export type InviteRequestInput = z.infer<typeof inviteRequestSchema>;

export type ParseResult = { ok: true; data: InviteRequestInput } | { ok: false; error: string };

export function parseInviteRequestInput(raw: unknown): ParseResult {
  const parsed = inviteRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  return { ok: true, data: parsed.data };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
