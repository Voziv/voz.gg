import Link from 'next/link';
import { count } from 'drizzle-orm';
import { db } from '@/db';
import { servers } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

function profileCompletion(user: {
  displayName: string | null;
  bio: string | null;
  minecraftUuid: string | null;
  steamId64: string | null;
}) {
  const fields = [user.displayName, user.bio, user.minecraftUuid, user.steamId64];
  const filled = fields.filter(Boolean).length;
  return { filled, total: fields.length };
}

export default async function DashboardOverview() {
  const { auth, user } = await requireUser();
  const [{ value: serverCount }] = await Promise.resolve(
    db.select({ value: count() }).from(servers).all(),
  );
  const completion = profileCompletion(user);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="mt-1 text-white/40">
          Welcome back, {user.displayName || auth.user?.firstName || auth.user?.email}.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Link href="/dashboard/profile" className="group">
          <Card className="border-[#1a1a2e] bg-[#0d0d14] transition-colors group-hover:border-[#00e5ff]/40">
            <CardHeader>
              <CardTitle className="text-white">Profile</CardTitle>
              <CardDescription className="text-white/40">
                {completion.filled}/{completion.total} fields filled
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {user.minecraftName ? (
                <Badge variant="outline" className="border-[#1a1a2e] text-white/80">
                  MC: {user.minecraftName}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-[#1a1a2e] text-white/40">
                  No Minecraft linked
                </Badge>
              )}
              {user.steamPersona ? (
                <Badge variant="outline" className="border-[#1a1a2e] text-white/80">
                  Steam: {user.steamPersona}
                </Badge>
              ) : user.steamId64 ? (
                <Badge variant="outline" className="border-[#1a1a2e] text-white/80">
                  Steam linked
                </Badge>
              ) : (
                <Badge variant="outline" className="border-[#1a1a2e] text-white/40">
                  No Steam linked
                </Badge>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/servers" className="group">
          <Card className="border-[#1a1a2e] bg-[#0d0d14] transition-colors group-hover:border-[#00e5ff]/40">
            <CardHeader>
              <CardTitle className="text-white">Servers</CardTitle>
              <CardDescription className="text-white/40">
                {serverCount} configured
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-white/60">
                View connection details and live status for all configured game servers.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
