# Invite-request flow design

**Date:** 2026-06-01
**Status:** Approved design, pending implementation plan

## Summary

Sign-in must no longer create accounts on demand. New people instead submit a
Turnstile-protected invite request (name, Discord name, email). An admin reviews
requests and either approves (which emails the requester a one-click magic-link
invite) or denies them. Account creation is gated to approved emails across every
sign-in method (Discord, Google, magic link).

## Goals

- Block account creation for anyone whose email has not been approved.
- Provide a public, bot-resistant invite-request form.
- Give admins a place to review and approve/deny requests.
- Approved requesters receive a one-click magic-link invite by email.
- Leave existing accounts and existing sign-in UX (for approved/existing users)
  working unchanged.

## Non-goals

- Bootstrapping the first admin (admins already exist with `role = 'admin'`).
- Notifying requesters on denial (denial is silent).
- Invite expiry / single-use consumption of an approved invite.
- A general-purpose admin area beyond the invite-requests page (the Admin nav
  group is introduced, but only the invite-requests tool lives under it now).

## Decisions (from brainstorming)

- **Approval flow:** approval emails a one-click magic-link invite.
- **Unapproved sign-in:** blocked, with a message pointing to the request form.
- **Form placement:** dedicated `/request-invite` page; Turnstile also guards the
  sign-in *magic-link* path (Discord/Google initiation is left unguarded — those
  flows are already bot-protected by the providers).
- **Admin UI:** a new admin-only **Admin** nav group with an **Invite requests**
  page at `/dashboard/admin/invites`.
- **Lifecycle:** block duplicate *pending* requests; allow a new request after a
  denial; **a `denied` request can be re-approved** (e.g. after the requester
  reaches out on Discord); optional deny reason; no denial email.
- **Emails:** approved requesters receive a distinct, nicely-designed HTML
  "you're approved" email; the magic-link sign-in email is also a designed HTML
  template. The sending address comes from the `FROM_EMAIL` worker env var (kept
  out of source), not a hardcoded string.
- **Gating mechanism:** Approach A — an allowlist gate in better-auth's
  `databaseHooks.user.create.before`, keyed off approved `invite_request` rows.

## Architecture

### Data model — `libs/shared/src/schema.ts`

New `invite_request` table (additive, backward-compatible migration):

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `name` | text NOT NULL | requester's name |
| `discord_name` | text NOT NULL | requester's Discord username |
| `email` | text NOT NULL | stored normalized (lowercased, trimmed); **not** unique so a denied email can re-request |
| `status` | text NOT NULL | `pending` \| `approved` \| `denied`, default `pending` |
| `deny_reason` | text | optional, set on denial |
| `reviewed_by` | text → `user.id` | admin who approved/denied |
| `reviewed_at` | timestamp | when reviewed |
| `created_at` | timestamp NOT NULL | |
| `updated_at` | timestamp NOT NULL | |

Add `INVITE_REQUEST_STATUSES` const tuple + `InviteRequestStatus` type alongside
the existing `GAME_TYPES` pattern.

Migration generated with `cd apps/web && npx drizzle-kit generate`. Purely
additive, so it satisfies the expand/contract rule automatically.

### Account-creation gate — `apps/web/src/lib/auth.ts`

Add a `databaseHooks` block:

```ts
databaseHooks: {
  user: {
    create: {
      before: async (newUser) => {
        const approved = await isEmailApproved(db, newUser.email);
        if (!approved) return false; // abort creation
        return { data: newUser };
      },
    },
  },
}
```

- `isEmailApproved(db, email)` (new helper, e.g. `lib/invite-dao.ts`) returns
  whether an `invite_request` row with the lowercased email exists in status
  `approved`.
- The hook fires only on user **creation**, so existing users and the admin sign
  in unaffected.
- Aborted creation surfaces as a sign-in error. `SignIn.tsx` reads the returned
  `?error=` query parameter and shows "No invite found for this email — request
  one" with a link to `/request-invite`. Exact error code/param is confirmed in
  implementation against better-auth's behavior.

### Turnstile

Mirror `~/dev/leerobert.ca` exactly:

- **Site key resolution** (client): precedence is `PUBLIC_TURNSTILE_SITE_KEY`
  env override → Cloudflare test key on `localhost`/`127.0.0.1` → hardcoded prod
  constant. Values:
  - test key: `1x00000000000000000000AA`
  - voz.gg prod key: `0x4AAAAAADdVDpZvTvq1DVEL`
- **Secret** (server): `env.TURNSTILE_SECRET_KEY` (already set in prod via
  `wrangler secret put`), falling back to the test secret
  `1x0000000000000000000000000000000AA` when unset locally. No `.dev.vars` change
  required for local dev.
- The prod site key is hardcoded as a constant (matching leerobert.ca, which does
  not store it in wrangler config). It is a public value, safe to commit.

Two verification paths:

1. **Magic-link sign-in** — better-auth **captcha plugin**:
   ```ts
   captcha({
     provider: 'cloudflare-turnstile',
     secretKey: env.TURNSTILE_SECRET_KEY ?? TURNSTILE_TEST_SECRET,
     endpoints: ['/sign-in/magic-link'],
   })
   ```
   `SignIn.tsx` sends the token via the `x-captcha-response` header on the
   `authClient.signIn.magicLink` call (`fetchOptions.headers`). Add
   `captchaClient`/equivalent to `auth-client.ts` if required by the plugin.
2. **Invite-request form** — custom `POST /api/invite-requests` is not a
   better-auth route, so it verifies the token directly with a new
   `lib/turnstile.ts` `verifyTurnstile(token, secret, remoteIp?)` helper calling
   `https://challenges.cloudflare.com/turnstile/v0/siteverify`.

A small React `Turnstile` island loads the Turnstile script and renders a
theme-aware widget, exposing the token to its parent form. Shared by
`RequestInviteForm.tsx` and `SignIn.tsx`.

### Pages, components, endpoints

**Public invite request**

- `apps/web/src/pages/request-invite.astro` — `prerender = false`, public.
  Renders `RequestInviteForm.tsx`.
- `apps/web/src/components/RequestInviteForm.tsx` — fields: name, Discord name,
  email + `Turnstile` widget. Submits to `POST /api/invite-requests`. Shows a
  success state and inline validation/errors.
- `apps/web/src/pages/api/invite-requests/index.ts` — `POST`: parse
  `{ name, discordName, email, turnstileToken }`; verify Turnstile; normalize
  email; reject with 409 if a `pending` request already exists for that email;
  insert a `pending` row; return 201. Public path (no session required).

**Sign-in**

- `apps/web/src/components/SignIn.tsx` — add the `Turnstile` widget to the
  magic-link form and attach the token header; add a "Need an invite? Request
  one" link to `/request-invite`; render the not-invited message when `?error=`
  indicates a blocked creation.

**Admin**

- `apps/web/src/layouts/Dashboard.astro` — add an **Admin** nav group, rendered
  only when `user.role === 'admin'`, containing an **Invite requests** link.
- `apps/web/src/pages/dashboard/admin/invites.astro` — `prerender = false`;
  server-side redirect to `/dashboard` (or 404) if the user is not admin.
  Server-loads requests grouped by status and renders `InviteRequestsTable.tsx`.
- `apps/web/src/components/dashboard/InviteRequestsTable.tsx` — lists requests
  with **Approve** and **Deny** actions. Deny opens a dialog with an optional
  reason field (follow the Base UI hydration guidance in AGENTS.md; reuse the
  Servers page dialog pattern).
- `apps/web/src/pages/api/invite-requests/[id]/approve.ts` — `POST`, `isAdmin`
  gated. Allowed when the row is `pending` **or** `denied` (re-approval). Set
  `status = approved`, `reviewed_by`, `reviewed_at`; then send the magic-link
  invite email (see below).
- `apps/web/src/pages/api/invite-requests/[id]/deny.ts` — `POST`, `isAdmin`
  gated. Allowed when the row is `pending`. Body `{ reason?: string }`; set
  `status = denied`, `deny_reason`, `reviewed_by`, `reviewed_at`. No email.

### Email sending — `apps/web/src/lib/email.ts` + new templates

**FROM address fix (prerequisite tweak).** The sole sender config is the
hardcoded `FROM` constant in `lib/email.ts`, currently `voz.gg
<noreply@voz.gg>`. Resend rejects this because the verified sending domain is
`mail.voz.gg`, and the real address must not be committed. Replace the constant
with `env.FROM_EMAIL` (already set in the worker prod env). `sendEmail` already
receives `env`, so it reads `env.FROM_EMAIL` directly; throw a clear error if it
is unset. This fixes every outbound mail, including the better-auth magic-link
emails (same `sendEmail`). Land it as its own atomic commit.

Typing/local-dev wiring:

- `Env` is generated by `wrangler types` into `worker-configuration.d.ts`,
  inferring keys from `.dev.vars`. Add `FROM_EMAIL` (and `TURNSTILE_SECRET_KEY`,
  not yet in the type) to local `.dev.vars`, then regenerate the type so
  `env.FROM_EMAIL` / `env.TURNSTILE_SECRET_KEY` are typed.
- Add `FROM_EMAIL=` and a commented `TURNSTILE_SECRET_KEY=` (optional locally,
  falls back to the test secret) to `.dev.vars.example` as placeholders — never
  the real address.

**Designed HTML templates.** Introduce a small templates module (e.g.
`lib/email-templates.ts`) returning `{ subject, html }`:

- `magicLinkSignInEmail({ url })` — the returning-user sign-in link.
- `inviteApprovedEmail({ url })` — the distinct "you're approved" invite, with
  welcoming copy and the same one-click link.

Both are responsive, table-based HTML with inline styles and voz.gg branding
(the project has no prior HTML email template to follow). `magicLink`'s
`sendMagicLink` callback and the approval flow call these instead of the current
inline `<p>` string.

**Distinguishing invite vs. sign-in.** On approval the handler calls
better-auth's server-side magic-link send so the link is verifiable, passing an
invite-context signal (a custom header, e.g. `x-invite-approval`, on the
`auth.api.signInMagicLink` call). `sendMagicLink({ email, url }, request)` reads
that header: present → `inviteApprovedEmail`; absent → `magicLinkSignInEmail`.
The header is the only reliable per-call context better-auth exposes to the
callback.

> Implementation risks to verify (cloudflare / better-auth skills):
> 1. Whether the server-side `auth.api.signInMagicLink` call trips the captcha
>    hook (since `/sign-in/magic-link` is captcha-protected). Likely bypassed —
>    captcha plugins typically skip when there is no incoming HTTP request — but
>    confirm. Fallbacks: scope the captcha hook to requests carrying the captcha
>    header, or call the lower-level magic-link generation directly.
> 2. That `sendMagicLink` receives the `request` (and thus the custom header) on
>    a server-side `auth.api` call. If not, fall back to a dedicated approval
>    code path that generates the token and sends `inviteApprovedEmail` directly.

### Route protection — `apps/web/src/lib/route-protection.ts`

Add `/request-invite` and `/api/invite-requests` to `PUBLIC_EXACT`. The
`/api/invite-requests/:id/approve` and `/deny` endpoints are **not** public:
they remain session-gated by middleware and additionally check `isAdmin` in the
handler (matching the existing Servers API).

## Data flow

1. Visitor opens `/request-invite`, fills the form, solves Turnstile → `POST
   /api/invite-requests` → token verified → no pending dup → `pending` row
   inserted → success message shown.
2. Admin opens `/dashboard/admin/invites`, reviews the request:
   - **Approve** → row set to `approved` + reviewer recorded → magic-link invite
     emailed.
   - **Deny** → row set to `denied` (+ optional reason). No email.
3. Approved requester clicks the magic link → better-auth verifies →
   `user.create.before` finds the `approved` invite → creation proceeds →
   session issued → redirected to `/dashboard`.
4. An un-approved person attempting any sign-in method → `user.create.before`
   aborts → `SignIn.tsx` shows "No invite found — request one".

## Error handling

- Invite-request endpoint: 400 on missing/invalid fields, 403/400 on failed
  Turnstile verification, 409 on an existing pending request, 500 on DB failure.
- Approve/deny endpoints: 403 if not admin, 404 if the id is unknown, 409 on an
  invalid transition — approve is rejected only when the row is already
  `approved`; deny is rejected when the row is not `pending`. 500 on failure.
- Magic-link send failure during approval: surface the error to the admin and do
  not silently mark approved without an email attempt; the status update and the
  send should be ordered so a failed send is visible (exact ordering decided in
  the plan).

## Testing (vitest, following existing `*.test.ts`)

- `lib/turnstile.ts` — `verifyTurnstile` success/failure with mocked fetch;
  test-secret fallback.
- Invite DAO — create blocks duplicate `pending`; allows a new request after a
  `denied` row exists; `isEmailApproved` true only for `approved`; approve
  transitions from both `pending` and `denied`; deny only from `pending`;
  invalid transitions rejected.
- Email templates — `inviteApprovedEmail` and `magicLinkSignInEmail` render the
  link and return distinct subjects/HTML; `sendEmail` posts with the
  `env.FROM_EMAIL` sender and throws when it is unset.
- Account-creation gate — `before` hook returns `false` for unapproved email,
  passes for approved email (using the DAO helper).
- `route-protection` — `/request-invite` and `/api/invite-requests` are public;
  `/api/invite-requests/:id/approve` and `/deny` are not.

## Open implementation questions

- Exact better-auth captcha plugin client wiring and the error code surfaced when
  `create.before` aborts (confirm against better-auth docs / skill).
- Whether server-side `auth.api.signInMagicLink` is subject to the captcha hook,
  and whether `sendMagicLink` receives the custom invite-context header on that
  call (see risk notes above).
