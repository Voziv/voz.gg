import { NextResponse, type NextRequest } from 'next/server';
import { eq, and, ne } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { verifySteamOpenIdResponse } from '@/lib/steam/openid';
import { fetchSteamSummary } from '@/lib/steam/api';

export async function GET(request: NextRequest) {
  const { user } = await requireUser();

  const url = new URL(request.url);
  const result = await verifySteamOpenIdResponse(url.searchParams);
  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/dashboard/profile?steam_error=${result.reason}`, request.url),
    );
  }

  const conflict = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.steamId64, result.steamId64), ne(users.id, user.id)))
    .get();
  if (conflict) {
    return NextResponse.redirect(
      new URL('/dashboard/profile?steam_error=already_linked', request.url),
    );
  }

  const summary = await fetchSteamSummary(result.steamId64);

  db.update(users)
    .set({
      steamId64: result.steamId64,
      steamPersona: summary?.personaName ?? null,
      steamAvatar: summary?.avatarUrl ?? null,
      updatedAt: Date.now(),
    })
    .where(eq(users.id, user.id))
    .run();

  return NextResponse.redirect(new URL('/dashboard/profile?linked=steam', request.url));
}
