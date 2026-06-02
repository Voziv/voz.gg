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
