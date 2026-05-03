import { redirect } from 'next/navigation';
import { withAuth } from '@workos-inc/authkit-nextjs';
import { buildSteamLoginUrl } from '@/lib/steam/openid';

export async function GET() {
  const auth = await withAuth();
  if (!auth.user) redirect('/sign-in');
  redirect(buildSteamLoginUrl());
}
