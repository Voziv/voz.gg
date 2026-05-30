import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, magicLink } from 'better-auth/plugins';
import { createDb } from '@voz/shared';
import * as schema from '@voz/shared';
import { sendEmail } from './email';

export function getAuth(env: Env) {
  const db = createDb(env.DB);

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
      },
    },
    plugins: [
      admin(),
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendEmail(env, {
            to: email,
            subject: 'Sign in to voz.gg',
            html: `<p>Click to sign in: <a href="${url}">${url}</a></p>`,
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof getAuth>;
