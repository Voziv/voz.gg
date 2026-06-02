import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, magicLinkClient, adminClient } from 'better-auth/client/plugins';
import type { Auth } from './auth';
import { ac, roles } from './permissions';

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>(), magicLinkClient(), adminClient({ ac, roles })],
});

export const { signIn, signOut, useSession } = authClient;
