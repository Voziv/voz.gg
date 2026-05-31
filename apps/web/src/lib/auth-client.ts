import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, magicLinkClient, adminClient } from 'better-auth/client/plugins';
import type { Auth } from './auth';

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>(), magicLinkClient(), adminClient()],
});

export const { signIn, signOut, useSession } = authClient;
