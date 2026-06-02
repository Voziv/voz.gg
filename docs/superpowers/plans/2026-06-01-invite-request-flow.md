# Invite-Request Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace open account creation with an invite-request flow: a Turnstile-protected public request form, an admin review UI (approve → emailed magic-link invite, or deny), and a better-auth gate that blocks account creation for non-approved emails.

**Architecture:** A new `invite_request` table is the allowlist. A better-auth `databaseHooks.user.create.before` hook aborts creation unless an `approved` invite exists for the email (covers Discord, Google, magic-link). The public form posts to a custom endpoint that verifies Turnstile manually; the sign-in magic-link path is guarded by better-auth's captcha plugin. Approval sends a magic link via `auth.api.signInMagicLink` with `metadata.invite` so `sendMagicLink` picks a distinct HTML template. Outbound mail sends from `env.FROM_EMAIL`.

**Tech Stack:** Astro SSR + Cloudflare Workers, better-auth 1.6.12 (admin, magicLink, captcha plugins), Drizzle + D1, React islands (Base UI), Zod, Resend, Cloudflare Turnstile, vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-01-invite-request-flow-design.md`

**Conventions (follow exactly):**
- Commit every task with DCO sign-off: `git commit -s`. Subject is a conventional commit (`feat(web): …`).
- Tests live next to source as `*.test.ts(x)`, run via `nx test web` (vitest, node env, no DB). Pure functions and dependency-injected interfaces are unit-tested; Drizzle DAOs, endpoints, and React islands are not (matches the existing codebase — see `agent-dao.ts` has no test, `agent-auth.ts` does).
- All work happens in the existing worktree; run commands from the repo root unless a `cwd` is given.
- A complete `.dev.vars` is already present in this worktree (gitignored). Do not delete it — `wrangler types` and `wrangler dev` depend on it.

---

## File Structure

**Shared (`libs/shared/src/`)**
- `schema.ts` (MODIFY) — add `INVITE_REQUEST_STATUSES`, `InviteRequestStatus`, `inviteRequest` table.

**Web lib (`apps/web/src/lib/`)**
- `invite-schema.ts` (CREATE) — Zod validation + `normalizeEmail`. Tested.
- `invite-transitions.ts` (CREATE) — `canApprove`, `canDeny` pure guards. Tested.
- `turnstile.ts` (CREATE) — `verifyTurnstile`, `resolveTurnstileSecret`, `TURNSTILE_TEST_SECRET`. Tested.
- `turnstile-site-key.ts` (CREATE) — `resolveSiteKey` + key constants. Tested.
- `email.ts` (MODIFY) — `resolveFromAddress(env)` from `env.FROM_EMAIL`; use it in `sendEmail`.
- `email-templates.ts` (CREATE) — `magicLinkSignInEmail`, `inviteApprovedEmail`. Tested.
- `invite-dao.ts` (CREATE) — `InviteDao` interface + `createInviteDao(db)`. Not unit-tested.
- `auth.ts` (MODIFY) — captcha plugin, create gate, `sendMagicLink` template branch, magic-link `expiresIn`.
- `route-protection.ts` (MODIFY) — add public paths. Test updated.

**Web pages (`apps/web/src/pages/`)**
- `request-invite.astro` (CREATE) — public form page.
- `sign-in.astro` (MODIFY) — pass `error` query param to `SignIn`.
- `api/invite-requests/index.ts` (CREATE) — public `POST` (Turnstile + create).
- `api/invite-requests/[id]/approve.ts` (CREATE) — admin `POST`.
- `api/invite-requests/[id]/deny.ts` (CREATE) — admin `POST`.
- `dashboard/admin/invites.astro` (CREATE) — admin-only review page.

**Web components (`apps/web/src/components/`)**
- `Turnstile.tsx` (CREATE) — Turnstile widget island.
- `RequestInviteForm.tsx` (CREATE) — request form island.
- `SignIn.tsx` (MODIFY) — Turnstile + captcha header + error message + request link.
- `dashboard/InviteRequestsTable.tsx` (CREATE) — admin table with approve/deny.

**Web layout (`apps/web/src/layouts/`)**
- `Dashboard.astro` (MODIFY) — admin-only "Admin" nav group.

**Migration**
- `apps/web/drizzle/migrations/000N_*.sql` (GENERATED) — additive `invite_request` table.

---

## Task 1: Add the `invite_request` schema

**Files:**
- Modify: `libs/shared/src/schema.ts` (append after the `user` table; the table references `user.id`)

- [ ] **Step 1: Add the status tuple, type, and table**

Append to `libs/shared/src/schema.ts` (after the `account`/`verification` tables, anywhere below the `user` definition):

```ts
export const INVITE_REQUEST_STATUSES = ['pending', 'approved', 'denied'] as const;

export type InviteRequestStatus = (typeof INVITE_REQUEST_STATUSES)[number];

export const inviteRequest = sqliteTable('invite_request', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  discordName: text('discord_name').notNull(),
  email: text('email').notNull(),
  status: text('status').notNull().$type<InviteRequestStatus>().default('pending'),
  denyReason: text('deny_reason'),
  reviewedBy: text('reviewed_by').references(() => user.id),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `cd apps/web && npx drizzle-kit generate`
Expected: a new file `apps/web/drizzle/migrations/000N_<name>.sql` containing `CREATE TABLE \`invite_request\``, plus updated `meta/` snapshot files. No prompts (purely additive).

- [ ] **Step 3: Apply the migration locally**

Run: `cd apps/web && npx wrangler d1 migrations apply voz-gg --local`
Expected: reports applying the new migration with no error.

- [ ] **Step 4: Verify the build still typechecks the shared lib**

Run: `npx nx build shared`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/schema.ts apps/web/drizzle/migrations
git commit -s -m "feat(shared): add invite_request table"
```

---

## Task 2: Invite-request validation (`invite-schema.ts`)

**Files:**
- Create: `apps/web/src/lib/invite-schema.ts`
- Test: `apps/web/src/lib/invite-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/invite-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseInviteRequestInput, normalizeEmail } from './invite-schema';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});

describe('parseInviteRequestInput', () => {
  it('accepts valid input and lowercases the email', () => {
    const r = parseInviteRequestInput({ name: 'Ada', discordName: 'ada#1', email: 'Ada@Example.com' });
    expect(r).toEqual({ ok: true, data: { name: 'Ada', discordName: 'ada#1', email: 'ada@example.com' } });
  });

  it('rejects a missing name', () => {
    const r = parseInviteRequestInput({ name: '', discordName: 'ada', email: 'a@b.co' });
    expect(r.ok).toBe(false);
  });

  it('rejects an invalid email', () => {
    const r = parseInviteRequestInput({ name: 'Ada', discordName: 'ada', email: 'not-an-email' });
    expect(r.ok).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(parseInviteRequestInput(null).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test web -- invite-schema`
Expected: FAIL — cannot resolve `./invite-schema`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/invite-schema.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test web -- invite-schema`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/invite-schema.ts apps/web/src/lib/invite-schema.test.ts
git commit -s -m "feat(web): add invite-request input validation"
```

---

## Task 3: Status-transition guards (`invite-transitions.ts`)

**Files:**
- Create: `apps/web/src/lib/invite-transitions.ts`
- Test: `apps/web/src/lib/invite-transitions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/invite-transitions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canApprove, canDeny } from './invite-transitions';

describe('canApprove', () => {
  it('allows pending and denied, rejects approved', () => {
    expect(canApprove('pending')).toBe(true);
    expect(canApprove('denied')).toBe(true);
    expect(canApprove('approved')).toBe(false);
  });
});

describe('canDeny', () => {
  it('allows only pending', () => {
    expect(canDeny('pending')).toBe(true);
    expect(canDeny('denied')).toBe(false);
    expect(canDeny('approved')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test web -- invite-transitions`
Expected: FAIL — cannot resolve `./invite-transitions`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/invite-transitions.ts`:

```ts
import type { InviteRequestStatus } from '@voz/shared';

// Re-approval of a denied request is intentional: someone may reach out after a
// denial and the admin can flip them. An already-approved request is a no-op.
export function canApprove(status: InviteRequestStatus): boolean {
  return status === 'pending' || status === 'denied';
}

export function canDeny(status: InviteRequestStatus): boolean {
  return status === 'pending';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test web -- invite-transitions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/invite-transitions.ts apps/web/src/lib/invite-transitions.test.ts
git commit -s -m "feat(web): add invite status-transition guards"
```

---

## Task 4: Turnstile server verification (`turnstile.ts`)

**Files:**
- Create: `apps/web/src/lib/turnstile.ts`
- Test: `apps/web/src/lib/turnstile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/turnstile.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { verifyTurnstile, resolveTurnstileSecret, TURNSTILE_TEST_SECRET } from './turnstile';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe('resolveTurnstileSecret', () => {
  it('returns the env secret when set', () => {
    expect(resolveTurnstileSecret({ TURNSTILE_SECRET_KEY: 'real' })).toBe('real');
  });
  it('falls back to the test secret when unset', () => {
    expect(resolveTurnstileSecret({})).toBe(TURNSTILE_TEST_SECRET);
  });
});

describe('verifyTurnstile', () => {
  it('returns false for an empty token without calling fetch', async () => {
    const fetchImpl = vi.fn();
    expect(await verifyTurnstile('', 'secret', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns true when siteverify reports success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    expect(await verifyTurnstile('tok', 'secret', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(true);
  });

  it('returns false when siteverify reports failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false }));
    expect(await verifyTurnstile('tok', 'secret', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(false);
  });

  it('returns false on a non-ok HTTP response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false));
    expect(await verifyTurnstile('tok', 'secret', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(false);
  });

  it('passes the remote IP through when provided', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    await verifyTurnstile('tok', 'secret', { remoteIp: '1.2.3.4', fetchImpl: fetchImpl as unknown as typeof fetch });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.body as URLSearchParams).get('remoteip')).toBe('1.2.3.4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test web -- turnstile`
Expected: FAIL — cannot resolve `./turnstile`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/turnstile.ts`:

```ts
// Cloudflare's "always passes" test secret — used locally when no real secret is set.
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

const SITE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function resolveTurnstileSecret(env: { TURNSTILE_SECRET_KEY?: string }): string {
  return env.TURNSTILE_SECRET_KEY || TURNSTILE_TEST_SECRET;
}

export async function verifyTurnstile(
  token: string,
  secret: string,
  options: { remoteIp?: string; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  if (!token) return false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (options.remoteIp) body.set('remoteip', options.remoteIp);

  const response = await fetchImpl(SITE_VERIFY_URL, { method: 'POST', body });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test web -- turnstile`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/turnstile.ts apps/web/src/lib/turnstile.test.ts
git commit -s -m "feat(web): add Turnstile server-side verification"
```

---

## Task 5: Turnstile site-key resolver (`turnstile-site-key.ts`)

**Files:**
- Create: `apps/web/src/lib/turnstile-site-key.ts`
- Test: `apps/web/src/lib/turnstile-site-key.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/turnstile-site-key.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveSiteKey, TURNSTILE_TEST_KEY, TURNSTILE_PROD_KEY } from './turnstile-site-key';

describe('resolveSiteKey', () => {
  it('prefers the explicit env key', () => {
    expect(resolveSiteKey({ hostname: 'voz.gg', envKey: 'override' })).toBe('override');
  });
  it('uses the test key on localhost', () => {
    expect(resolveSiteKey({ hostname: 'localhost' })).toBe(TURNSTILE_TEST_KEY);
    expect(resolveSiteKey({ hostname: '127.0.0.1' })).toBe(TURNSTILE_TEST_KEY);
  });
  it('uses the prod key elsewhere', () => {
    expect(resolveSiteKey({ hostname: 'voz.gg' })).toBe(TURNSTILE_PROD_KEY);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test web -- turnstile-site-key`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/turnstile-site-key.ts`:

```ts
// Public Turnstile site keys (safe to commit). Mirrors the leerobert.ca pattern.
export const TURNSTILE_TEST_KEY = '1x00000000000000000000AA';
export const TURNSTILE_PROD_KEY = '0x4AAAAAADdVDpZvTvq1DVEL';

// Precedence: explicit build-time env override, else the test key on localhost,
// else the production key.
export function resolveSiteKey(opts: { hostname: string; envKey?: string }): string {
  if (opts.envKey) return opts.envKey;
  if (opts.hostname === 'localhost' || opts.hostname === '127.0.0.1') return TURNSTILE_TEST_KEY;
  return TURNSTILE_PROD_KEY;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test web -- turnstile-site-key`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/turnstile-site-key.ts apps/web/src/lib/turnstile-site-key.test.ts
git commit -s -m "feat(web): add Turnstile site-key resolver"
```

---

## Task 6: Mail FROM from env + HTML templates

**Files:**
- Modify: `apps/web/src/lib/email.ts`
- Create: `apps/web/src/lib/email-templates.ts`
- Test: `apps/web/src/lib/email.test.ts`
- Test: `apps/web/src/lib/email-templates.test.ts`

- [ ] **Step 1: Write the failing test for the FROM resolver**

Create `apps/web/src/lib/email.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveFromAddress } from './email';

describe('resolveFromAddress', () => {
  it('returns the configured FROM_EMAIL', () => {
    expect(resolveFromAddress({ FROM_EMAIL: 'voz.gg <noreply@mail.voz.gg>' })).toBe('voz.gg <noreply@mail.voz.gg>');
  });
  it('throws when FROM_EMAIL is unset', () => {
    expect(() => resolveFromAddress({})).toThrow(/FROM_EMAIL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test web -- email.test`
Expected: FAIL — `resolveFromAddress` is not exported.

- [ ] **Step 3: Modify `email.ts`**

Replace the `FROM` constant and its use. The full file becomes:

```ts
export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export function resolveFromAddress(env: { FROM_EMAIL?: string }): string {
  if (!env.FROM_EMAIL) {
    throw new Error('FROM_EMAIL is not set; cannot send email.');
  }
  return env.FROM_EMAIL;
}

export async function sendEmail(env: Env, input: SendEmailInput): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resolveFromAddress(env),
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  });
  if (!response.ok) {
    throw new Error(`Email send failed: ${response.status} ${await response.text()}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test web -- email.test`
Expected: PASS.

- [ ] **Step 5: Write the failing test for templates**

Create `apps/web/src/lib/email-templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { magicLinkSignInEmail, inviteApprovedEmail } from './email-templates';

describe('email templates', () => {
  const url = 'https://voz.gg/api/auth/magic-link/verify?token=abc';

  it('magicLinkSignInEmail embeds the url and has a sign-in subject', () => {
    const { subject, html } = magicLinkSignInEmail({ url });
    expect(html).toContain(url);
    expect(subject.toLowerCase()).toContain('sign in');
  });

  it('inviteApprovedEmail embeds the url and has a distinct subject', () => {
    const signIn = magicLinkSignInEmail({ url });
    const invite = inviteApprovedEmail({ url });
    expect(invite.html).toContain(url);
    expect(invite.subject).not.toBe(signIn.subject);
    expect(invite.subject.toLowerCase()).toContain('voz.gg');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx nx test web -- email-templates`
Expected: FAIL — cannot resolve `./email-templates`.

- [ ] **Step 7: Write the templates**

Create `apps/web/src/lib/email-templates.ts`:

```ts
export interface EmailContent {
  subject: string;
  html: string;
}

function layout(opts: { heading: string; intro: string; url: string; cta: string }): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#0b0b0c;color:#e7e7ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0c;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#151518;border:1px solid #26262b;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px;">
                <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">voz.gg</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#ffffff;">${opts.heading}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#b5b5bd;">${opts.intro}</p>
                <a href="${opts.url}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${opts.cta}</a>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#7c7c86;">Or paste this link into your browser:<br /><a href="${opts.url}" style="color:#9aa0ff;word-break:break-all;">${opts.url}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#5c5c66;">If you weren't expecting this email, you can safely ignore it. This link expires in 1 hour.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function magicLinkSignInEmail({ url }: { url: string }): EmailContent {
  return {
    subject: 'Sign in to voz.gg',
    html: layout({
      heading: 'Sign in to voz.gg',
      intro: 'Click the button below to sign in to your account.',
      url,
      cta: 'Sign in',
    }),
  };
}

export function inviteApprovedEmail({ url }: { url: string }): EmailContent {
  return {
    subject: "You're approved — welcome to voz.gg",
    html: layout({
      heading: "You're in!",
      intro: 'Your invite request was approved. Click below to set up your account and sign in.',
      url,
      cta: 'Accept your invite',
    }),
  };
}
```

- [ ] **Step 8: Run all the touched tests**

Run: `npx nx test web -- email`
Expected: PASS (email.test + email-templates).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/email.ts apps/web/src/lib/email.test.ts apps/web/src/lib/email-templates.ts apps/web/src/lib/email-templates.test.ts
git commit -s -m "feat(web): source mail FROM from env and add HTML templates"
```

---

## Task 7: Invite DAO (`invite-dao.ts`)

**Files:**
- Create: `apps/web/src/lib/invite-dao.ts`

No unit test (Drizzle DAO; mirrors `agent-dao.ts`). Logic that needs testing lives in `invite-schema.ts`/`invite-transitions.ts`.

- [ ] **Step 1: Write the implementation**

Create `apps/web/src/lib/invite-dao.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import { inviteRequest, type Db } from '@voz/shared';
import { normalizeEmail } from './invite-schema';

export type InviteRequestRow = typeof inviteRequest.$inferSelect;

export interface CreateInviteInput {
  id: string;
  name: string;
  discordName: string;
  email: string;
  now: Date;
}

export interface InviteDao {
  pendingExistsForEmail(email: string): Promise<boolean>;
  create(input: CreateInviteInput): Promise<void>;
  isEmailApproved(email: string): Promise<boolean>;
  byId(id: string): Promise<InviteRequestRow | null>;
  approve(id: string, reviewedBy: string, at: Date): Promise<void>;
  deny(id: string, reviewedBy: string, reason: string | null, at: Date): Promise<void>;
  listAll(): Promise<InviteRequestRow[]>;
}

export function createInviteDao(db: Db): InviteDao {
  return {
    async pendingExistsForEmail(email) {
      const row = await db
        .select({ id: inviteRequest.id })
        .from(inviteRequest)
        .where(and(eq(inviteRequest.email, normalizeEmail(email)), eq(inviteRequest.status, 'pending')))
        .get();
      return !!row;
    },

    async create({ id, name, discordName, email, now }) {
      await db.insert(inviteRequest).values({
        id,
        name,
        discordName,
        email: normalizeEmail(email),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });
    },

    async isEmailApproved(email) {
      const row = await db
        .select({ id: inviteRequest.id })
        .from(inviteRequest)
        .where(and(eq(inviteRequest.email, normalizeEmail(email)), eq(inviteRequest.status, 'approved')))
        .get();
      return !!row;
    },

    async byId(id) {
      const row = await db.select().from(inviteRequest).where(eq(inviteRequest.id, id)).get();
      return row ?? null;
    },

    async approve(id, reviewedBy, at) {
      await db
        .update(inviteRequest)
        .set({ status: 'approved', reviewedBy, reviewedAt: at, updatedAt: at })
        .where(eq(inviteRequest.id, id));
    },

    async deny(id, reviewedBy, reason, at) {
      await db
        .update(inviteRequest)
        .set({ status: 'denied', denyReason: reason, reviewedBy, reviewedAt: at, updatedAt: at })
        .where(eq(inviteRequest.id, id));
    },

    async listAll() {
      return db.select().from(inviteRequest).orderBy(desc(inviteRequest.createdAt)).all();
    },
  };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx nx build web` (or wait for the build verification in Task 14 if iterating fast)
Expected: no type errors referencing `invite-dao.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/invite-dao.ts
git commit -s -m "feat(web): add invite-request data-access layer"
```

---

## Task 8: Wire the auth gate, captcha, and email branch (`auth.ts`)

**Files:**
- Modify: `apps/web/src/lib/auth.ts`

No unit test (better-auth config/integration; verified by build + manual run). The gate delegates to the tested `isEmailApproved`.

- [ ] **Step 1: Replace `auth.ts` with the wired version**

Full new contents of `apps/web/src/lib/auth.ts`:

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, magicLink, captcha } from 'better-auth/plugins';
import { createDb } from '@voz/shared';
import * as schema from '@voz/shared';
import { sendEmail } from './email';
import { magicLinkSignInEmail, inviteApprovedEmail } from './email-templates';
import { createInviteDao } from './invite-dao';
import { resolveTurnstileSecret } from './turnstile';

export function getAuth(env: Env) {
  const db = createDb(env.DB);
  const inviteDao = createInviteDao(db);

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    socialProviders: {
      discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account',
      },
    },
    user: {
      additionalFields: {
        displayName: { type: 'string', required: false, input: true },
        bio: { type: 'string', required: false, input: true },
        minecraftUuid: { type: 'string', required: false, input: false },
        minecraftName: { type: 'string', required: false, input: false },
        steamId64: { type: 'string', required: false, input: false, unique: true },
        steamPersona: { type: 'string', required: false, input: false },
        steamAvatar: { type: 'string', required: false, input: false },
        theme: { type: 'string', required: false, input: true },
      },
    },
    // Account creation is invite-only: abort unless an approved invite exists for
    // the email. Fires on creation only, so existing accounts sign in unaffected.
    databaseHooks: {
      user: {
        create: {
          before: async (newUser) => inviteDao.isEmailApproved(newUser.email),
        },
      },
    },
    plugins: [
      admin(),
      // Bot-protect the magic-link email request. This is an onRequest HTTP
      // middleware keyed on the `x-captcha-response` header; server-side
      // `auth.api.signInMagicLink` calls (used by invite approval) bypass it.
      captcha({
        provider: 'cloudflare-turnstile',
        secretKey: resolveTurnstileSecret(env),
        endpoints: ['/sign-in/magic-link'],
      }),
      magicLink({
        // Emailed invite links may be opened minutes later, so widen the default
        // 5-minute window. Tradeoff: a valid sign-in link lives for up to an hour.
        expiresIn: 60 * 60,
        sendMagicLink: async ({ email, url, metadata }) => {
          const content = metadata?.invite ? inviteApprovedEmail({ url }) : magicLinkSignInEmail({ url });
          await sendEmail(env, { to: email, subject: content.subject, html: content.html });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof getAuth>;
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx nx build web`
Expected: success. If the `captcha` import path errors, confirm it is exported from `better-auth/plugins` (it is in 1.6.12).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/auth.ts
git commit -s -m "feat(web): gate account creation to approved invites"
```

---

## Task 9: Public route protection (`route-protection.ts`)

**Files:**
- Modify: `apps/web/src/lib/route-protection.ts`
- Modify: `apps/web/src/lib/route-protection.test.ts`

- [ ] **Step 1: Extend the test first**

In `apps/web/src/lib/route-protection.test.ts`, add `'/request-invite'` and `'/api/invite-requests'` to the public `it.each` array, and add a protected case for the admin endpoints. The two `it.each` blocks become:

```ts
  it.each([
    '/',
    '/sign-in',
    '/request-invite',
    '/api/invite-requests',
    '/api/auth/sign-in/social',
    '/api/auth/callback/discord',
    '/api/auth/steam/initiate',
    '/api/agents/enroll',
    '/api/agents/config',
    '/api/status',
  ])('treats %s as public', (p) => expect(isPublicPath(p)).toBe(true));

  it.each([
    '/dashboard',
    '/dashboard/profile',
    '/dashboard/servers',
    '/dashboard/admin/invites',
    '/api/invite-requests/abc123/approve',
    '/api/invite-requests/abc123/deny',
  ])('treats %s as protected', (p) => expect(isPublicPath(p)).toBe(false));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test web -- route-protection`
Expected: FAIL on `/request-invite` and `/api/invite-requests` (currently not public).

- [ ] **Step 3: Add the public paths**

In `apps/web/src/lib/route-protection.ts`, update the set:

```ts
const PUBLIC_EXACT = new Set([
  '/',
  '/sign-in',
  '/request-invite',
  '/api/invite-requests',
  '/api/agents/enroll',
  '/api/agents/config',
  '/api/status',
]);
```

(The `/api/invite-requests/:id/approve|deny` paths are not exact matches, so they stay protected — the test confirms this.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test web -- route-protection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/route-protection.ts apps/web/src/lib/route-protection.test.ts
git commit -s -m "feat(web): make invite-request routes public"
```

---

## Task 10: Public invite-request endpoint

**Files:**
- Create: `apps/web/src/pages/api/invite-requests/index.ts`

No unit test (endpoint; mirrors untested `api/servers/index.ts`). Logic is in tested helpers.

- [ ] **Step 1: Write the endpoint**

Create `apps/web/src/pages/api/invite-requests/index.ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { nanoid } from 'nanoid';
import { createDb } from '@voz/shared';
import { createInviteDao } from '../../../lib/invite-dao';
import { parseInviteRequestInput } from '../../../lib/invite-schema';
import { verifyTurnstile, resolveTurnstileSecret } from '../../../lib/turnstile';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const raw = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof raw.turnstileToken === 'string' ? raw.turnstileToken : '';
  const remoteIp = ctx.request.headers.get('CF-Connecting-IP') ?? undefined;

  const human = await verifyTurnstile(token, resolveTurnstileSecret(env), { remoteIp });
  if (!human) {
    return Response.json({ ok: false, error: 'Verification failed. Please try again.' }, { status: 400 });
  }

  const parsed = parseInviteRequestInput(raw);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const db = createDb(env.DB);
  const dao = createInviteDao(db);

  if (await dao.pendingExistsForEmail(parsed.data.email)) {
    return Response.json(
      { ok: false, error: 'A request for this email is already pending.' },
      { status: 409 },
    );
  }

  await dao.create({
    id: nanoid(12),
    name: parsed.data.name,
    discordName: parsed.data.discordName,
    email: parsed.data.email,
    now: new Date(),
  });

  return Response.json({ ok: true }, { status: 201 });
};
```

- [ ] **Step 2: Verify build**

Run: `npx nx build web`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/api/invite-requests/index.ts
git commit -s -m "feat(web): add public invite-request submission endpoint"
```

---

## Task 11: Admin approve/deny endpoints

**Files:**
- Create: `apps/web/src/pages/api/invite-requests/[id]/approve.ts`
- Create: `apps/web/src/pages/api/invite-requests/[id]/deny.ts`

- [ ] **Step 1: Write the approve endpoint**

Create `apps/web/src/pages/api/invite-requests/[id]/approve.ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { isAdmin } from '../../../../lib/admin';
import { createInviteDao } from '../../../../lib/invite-dao';
import { canApprove } from '../../../../lib/invite-transitions';
import { getAuth } from '../../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const id = ctx.params.id;
  if (!id) return new Response('Bad Request', { status: 400 });

  const db = createDb(env.DB);
  const dao = createInviteDao(db);
  const row = await dao.byId(id);
  if (!row) return Response.json({ ok: false, error: 'Request not found.' }, { status: 404 });
  if (!canApprove(row.status)) {
    return Response.json({ ok: false, error: 'Request is already approved.' }, { status: 409 });
  }

  // Send first, mark approved second: a send failure leaves the row in its prior
  // state so the admin can retry. The user opens the email seconds later, well
  // after `approve` below has committed, so the create-gate sees `approved`.
  const auth = getAuth(env as Env);
  await auth.api.signInMagicLink({
    body: {
      email: row.email,
      callbackURL: '/dashboard',
      errorCallbackURL: '/sign-in?error=no_invite',
      metadata: { invite: true },
    },
  });

  await dao.approve(id, user.id, new Date());

  return Response.json({ ok: true });
};
```

- [ ] **Step 2: Write the deny endpoint**

Create `apps/web/src/pages/api/invite-requests/[id]/deny.ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { isAdmin } from '../../../../lib/admin';
import { createInviteDao } from '../../../../lib/invite-dao';
import { canDeny } from '../../../../lib/invite-transitions';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  const id = ctx.params.id;
  if (!id) return new Response('Bad Request', { status: 400 });

  const raw = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
  const reasonInput = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  const reason = reasonInput.length > 0 ? reasonInput.slice(0, 500) : null;

  const db = createDb(env.DB);
  const dao = createInviteDao(db);
  const row = await dao.byId(id);
  if (!row) return Response.json({ ok: false, error: 'Request not found.' }, { status: 404 });
  if (!canDeny(row.status)) {
    return Response.json({ ok: false, error: 'Only pending requests can be denied.' }, { status: 409 });
  }

  await dao.deny(id, user.id, reason, new Date());

  return Response.json({ ok: true });
};
```

- [ ] **Step 3: Verify build**

Run: `npx nx build web`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/api/invite-requests
git commit -s -m "feat(web): add admin approve/deny invite endpoints"
```

---

## Task 12: Turnstile widget island (`Turnstile.tsx`)

**Files:**
- Create: `apps/web/src/components/Turnstile.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/Turnstile.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { resolveSiteKey } from '../lib/turnstile-site-key';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadScript(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(script);
  });
}

type Props = {
  onVerify: (token: string) => void;
  onExpire?: () => void;
};

export default function Turnstile({ onVerify, onExpire }: Props) {
  const container = useRef<HTMLDivElement>(null);
  // Stash callbacks in refs so the widget renders exactly once (a fresh callback
  // identity each render must not re-trigger the effect).
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  onVerifyRef.current = onVerify;
  onExpireRef.current = onExpire;

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;

    const siteKey = resolveSiteKey({
      hostname: window.location.hostname,
      envKey: import.meta.env.PUBLIC_TURNSTILE_SITE_KEY,
    });
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme,
          callback: (token: string) => onVerifyRef.current(token),
          'expired-callback': () => onExpireRef.current?.(),
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  return <div ref={container} />;
}
```

- [ ] **Step 2: Verify build**

Run: `npx nx build web`
Expected: success. (`import.meta.env.PUBLIC_TURNSTILE_SITE_KEY` is allowed even when unset.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/Turnstile.tsx
git commit -s -m "feat(web): add Turnstile widget island"
```

---

## Task 13: Request-invite form + page

**Files:**
- Create: `apps/web/src/components/RequestInviteForm.tsx`
- Create: `apps/web/src/pages/request-invite.astro`

- [ ] **Step 1: Write the form component**

Create `apps/web/src/components/RequestInviteForm.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import Turnstile from './Turnstile';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';

export default function RequestInviteForm() {
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      toast.error('Please complete the verification.');
      return;
    }
    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get('name'),
      discordName: form.get('discordName'),
      email: form.get('email'),
      turnstileToken: token,
    };
    setPending(true);
    try {
      const res = await fetch('/api/invite-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (r.ok) {
        setDone(true);
      } else {
        toast.error(r.error ?? 'Could not submit your request.');
      }
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <p className="w-full max-w-sm rounded border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
        Thanks! Your request has been submitted. If you're approved, we'll email you an invite link.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required maxLength={80} autoComplete="name" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="discordName">Discord username</Label>
        <Input id="discordName" name="discordName" required maxLength={80} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required maxLength={254} autoComplete="email" />
      </div>
      <Turnstile onVerify={setToken} onExpire={() => setToken('')} />
      <Button type="submit" disabled={pending || !token}>
        {pending ? 'Submitting…' : 'Request an invite'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Write the page**

Create `apps/web/src/pages/request-invite.astro`:

```astro
---
export const prerender = false;
import Base from '../layouts/Base.astro';
import RequestInviteForm from '../components/RequestInviteForm.tsx';
import ThemeToggle from '../components/ThemeToggle.tsx';
if (Astro.locals.user) return Astro.redirect('/dashboard');
---
<Base>
  <main class="min-h-screen flex flex-col items-center justify-center gap-8 bg-background text-foreground p-12">
    <div class="fixed right-4 top-4 z-50">
      <ThemeToggle client:load />
    </div>
    <div class="text-center">
      <h1 class="text-4xl font-bold tracking-tight">Request an invite</h1>
      <p class="mt-2 max-w-sm text-muted-foreground">voz.gg is invite-only. Tell us a bit about yourself and we'll be in touch.</p>
    </div>
    <RequestInviteForm client:load />
    <a href="/sign-in" class="text-sm text-muted-foreground hover:text-foreground">Already have an account? Sign in</a>
  </main>
</Base>
```

- [ ] **Step 3: Verify build**

Run: `npx nx build web`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/RequestInviteForm.tsx apps/web/src/pages/request-invite.astro
git commit -s -m "feat(web): add invite-request form and page"
```

---

## Task 14: Sign-in page — Turnstile, captcha header, error message

**Files:**
- Modify: `apps/web/src/components/SignIn.tsx`
- Modify: `apps/web/src/pages/sign-in.astro`

- [ ] **Step 1: Rewrite `SignIn.tsx`**

Full new contents of `apps/web/src/components/SignIn.tsx`:

```tsx
import { useState } from 'react';
import { authClient } from '../lib/auth-client';
import Turnstile from './Turnstile';

type Props = { error?: string | null };

export default function SignIn({ error }: Props) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  const social = (provider: 'discord' | 'google') =>
    authClient.signIn.social({
      provider,
      callbackURL: '/dashboard',
      errorCallbackURL: '/sign-in?error=no_invite',
    });

  const magicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setPending(true);
    try {
      await authClient.signIn.magicLink(
        { email, callbackURL: '/dashboard', errorCallbackURL: '/sign-in?error=no_invite' },
        { headers: { 'x-captcha-response': token } },
      );
      setSent(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-sm">
      {error && (
        <p
          role="alert"
          className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          No invite found for this email.{' '}
          <a className="underline" href="/request-invite">Request one</a>.
        </p>
      )}
      <button onClick={() => social('discord')} className="rounded bg-[#5865F2] py-2 font-semibold">
        Continue with Discord
      </button>
      <button onClick={() => social('google')} className="rounded bg-white text-black py-2 font-semibold">
        Continue with Google
      </button>
      <form onSubmit={magicLink} className="flex flex-col gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded bg-muted px-3 py-2"
        />
        <Turnstile onVerify={setToken} onExpire={() => setToken('')} />
        <button
          type="submit"
          disabled={pending || !token}
          className="rounded border border-primary text-primary py-2 disabled:opacity-50"
        >
          Email me a magic link
        </button>
      </form>
      {sent && <p className="text-success text-sm">Check your email for a sign-in link.</p>}
      <a href="/request-invite" className="text-center text-sm text-muted-foreground hover:text-foreground">
        Need an invite? Request one
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Pass the error param from `sign-in.astro`**

Edit `apps/web/src/pages/sign-in.astro`. Add a line reading the query param in the frontmatter and pass it as a prop:

Frontmatter (after the redirect line):
```astro
const error = Astro.url.searchParams.get('error');
```

Markup — change `<SignIn client:load />` to:
```astro
<SignIn client:load error={error} />
```

- [ ] **Step 3: Verify build**

Run: `npx nx build web`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/SignIn.tsx apps/web/src/pages/sign-in.astro
git commit -s -m "feat(web): add Turnstile and invite messaging to sign-in"
```

---

## Task 15: Admin review UI

**Files:**
- Create: `apps/web/src/components/dashboard/InviteRequestsTable.tsx`
- Create: `apps/web/src/pages/dashboard/admin/invites.astro`
- Modify: `apps/web/src/layouts/Dashboard.astro`

- [ ] **Step 1: Write the table component**

Create `apps/web/src/components/dashboard/InviteRequestsTable.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';

type InviteStatus = 'pending' | 'approved' | 'denied';

type InviteRow = {
  id: string;
  name: string;
  discordName: string;
  email: string;
  status: InviteStatus;
  denyReason: string | null;
  createdAt: number;
};

type Props = { requests: InviteRow[] };

const STATUS_STYLES: Record<InviteStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  approved: 'bg-success/15 text-success',
  denied: 'bg-destructive/15 text-destructive',
};

async function post(url: string, body?: unknown): Promise<boolean> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const r = (await res.json().catch(() => ({ ok: false, error: 'Request failed.' }))) as {
    ok: boolean;
    error?: string;
  };
  if (!r.ok) toast.error(r.error ?? 'Action failed.');
  return r.ok;
}

function DenyDialog({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = new FormData(e.currentTarget).get('reason');
    setPending(true);
    try {
      if (await post(`/api/invite-requests/${id}/deny`, { reason })) {
        toast.success('Request denied.');
        location.reload();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={cn(buttonVariants({ variant: 'destructive', size: 'sm' }))}>Deny</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Deny {name}'s request</DialogTitle>
            <DialogDescription>Optionally record a reason. The requester is not notified.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5 py-4">
            <Label htmlFor={`reason-${id}`}>Reason (optional)</Label>
            <Input id={`reason-${id}`} name="reason" maxLength={500} />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Denying…' : 'Deny request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApproveButton({ id }: { id: string }) {
  const [pending, setPending] = useState(false);
  async function handleClick() {
    if (!confirm('Approve and email an invite link?')) return;
    setPending(true);
    try {
      if (await post(`/api/invite-requests/${id}/approve`)) {
        toast.success('Approved — invite emailed.');
        location.reload();
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <Button type="button" size="sm" disabled={pending} onClick={handleClick}>
      {pending ? 'Approving…' : 'Approve'}
    </Button>
  );
}

export default function InviteRequestsTable({ requests }: Props) {
  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card py-12 text-center text-muted-foreground">
        No invite requests yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Discord</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr className="border-t border-border" key={r.id}>
              <td className="px-4 py-3 text-foreground">{r.name}</td>
              <td className="px-4 py-3 text-muted-foreground">{r.discordName}</td>
              <td className="px-4 py-3 font-mono text-muted-foreground">{r.email}</td>
              <td className="px-4 py-3">
                <span className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS_STYLES[r.status])}>
                  {r.status}
                </span>
                {r.status === 'denied' && r.denyReason && (
                  <div className="mt-1 text-xs text-muted-foreground">{r.denyReason}</div>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  {r.status === 'pending' && (
                    <>
                      <ApproveButton id={r.id} />
                      <DenyDialog id={r.id} name={r.name} />
                    </>
                  )}
                  {r.status === 'denied' && <ApproveButton id={r.id} />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Write the admin page**

Create `apps/web/src/pages/dashboard/admin/invites.astro`:

```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
import { createDb } from '@voz/shared';
import { createInviteDao } from '../../../lib/invite-dao';
import { isAdmin } from '../../../lib/admin';
import Dashboard from '../../../layouts/Dashboard.astro';
import InviteRequestsTable from '../../../components/dashboard/InviteRequestsTable.tsx';

if (!isAdmin(Astro.locals.user)) return Astro.redirect('/dashboard/profile');

const db = createDb(env.DB);
const dao = createInviteDao(db);
const requests = (await dao.listAll()).map((r) => ({
  id: r.id,
  name: r.name,
  discordName: r.discordName,
  email: r.email,
  status: r.status,
  denyReason: r.denyReason,
  createdAt: r.createdAt.getTime(),
}));
---
<Dashboard>
  <div class="mx-auto max-w-5xl">
    <div class="mb-8">
      <h1 class="text-3xl font-bold tracking-tight">Invite requests</h1>
      <p class="mt-1 text-muted-foreground">Approve to email a magic-link invite, or deny.</p>
    </div>
    <InviteRequestsTable client:load requests={requests} />
  </div>
</Dashboard>
```

- [ ] **Step 3: Add the admin nav group in `Dashboard.astro`**

In `apps/web/src/layouts/Dashboard.astro` frontmatter, after the existing `nav` array add:

```astro
const isUserAdmin = user?.role === 'admin';
const adminNav = [{ href: '/dashboard/admin/invites', label: 'Invite requests' }];
```

In the `<nav>` block, after the existing `{nav.map(...)}` expression, add an admin group:

```astro
        {isUserAdmin && (
          <>
            <div class="mt-4 px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Admin</div>
            {adminNav.map((item) => (
              <a
                href={item.href}
                class:list={[
                  'rounded-md px-3 py-2 text-sm transition-colors',
                  isActive(item.href)
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                ]}
              >{item.label}</a>
            ))}
          </>
        )}
```

- [ ] **Step 4: Verify build**

Run: `npx nx build web`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/dashboard/InviteRequestsTable.tsx apps/web/src/pages/dashboard/admin/invites.astro apps/web/src/layouts/Dashboard.astro
git commit -s -m "feat(web): add admin invite-requests review UI"
```

---

## Task 16: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full web test suite**

Run: `npx nx test web`
Expected: PASS — including the new invite-schema, invite-transitions, turnstile, turnstile-site-key, email, email-templates, and route-protection tests.

- [ ] **Step 2: Lint**

Run: `npx nx lint web`
Expected: no errors. (Module-boundary rules: all new imports are within `web` or from `@voz/shared` (a `type:lib`), so they comply.)

- [ ] **Step 3: Build**

Run: `npx nx build web`
Expected: success.

- [ ] **Step 4: Confirm the migration is applied locally**

Run: `cd apps/web && npx wrangler d1 migrations apply voz-gg --local`
Expected: "No migrations to apply" (already applied in Task 1) or applies cleanly.

- [ ] **Step 5: Manual smoke test (local)**

Run: `npx nx run web:preview` (builds + `wrangler dev` with D1).
Then verify in a browser:
1. `/request-invite` renders the form with a Turnstile widget; submitting (Turnstile auto-passes locally with the test key) shows the success message; a row appears in D1.
2. Submitting the same email again shows "already pending".
3. As an admin (`role='admin'` user), `/dashboard/admin/invites` lists the request with Approve/Deny; the "Admin" nav group is visible.
4. Deny with a reason → status flips to denied, reason shown, Approve button remains (re-approve).
5. Approve → status approved; check the wrangler dev logs for the Resend send attempt (will error without a real `RESEND_API_KEY`/verified domain — that's expected locally; the flow up to the send is what matters).
6. `/sign-in?error=no_invite` shows the "No invite found — Request one" message.

Note any failures in the task report rather than silently fixing scope creep.

- [ ] **Step 6: Final confirmation**

No commit needed (verification only). If any step revealed a defect, fix it in a focused follow-up commit referencing the task it belongs to.

---

## Self-review notes (author)

- **Spec coverage:** schema (T1), creation gate (T8), Turnstile on request form (T4/T10) + magic-link captcha (T8/T14), request form/page (T13), sign-in messaging (T14), admin nav + page + approve/deny incl. re-approval (T11/T15), FROM env + HTML templates (T6/T8), public route protection (T9), wrangler types groundwork (already committed). All spec sections map to a task.
- **Type consistency:** `InviteRequestStatus` (T1) is used by `canApprove`/`canDeny` (T3), `InviteDao` (T7), and the table's `InviteStatus` literal (T15) which intentionally restates the three values for the serialized island prop. `createInviteDao`/`InviteDao` method names are identical across T7, T8, T10, T11, T15.
- **Open risks already de-risked during planning:** captcha `onRequest` bypass for server-side `signInMagicLink` (confirmed in plugin source); `metadata` passthrough to `sendMagicLink` (confirmed in magic-link source); `before` returning `false` aborts creation (confirmed in core types).
- **Deliberate choices to flag in review:** magic-link `expiresIn` widened to 1 hour (affects normal sign-in links too); approve sends-then-marks for retry safety (sub-second race is acceptable); no denial email (per spec).
