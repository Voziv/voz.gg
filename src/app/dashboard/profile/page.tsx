import { requireUser } from '@/lib/auth';
import { fetchSteamSummary } from '@/lib/steam/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ProfileForm } from '@/components/dashboard/profile-form';
import { MinecraftField } from '@/components/dashboard/minecraft-field';
import { SteamLinkCard } from '@/components/dashboard/steam-link-card';
import { ErrorBanner } from '@/components/dashboard/error-banner';

const STEAM_ERRORS: Record<string, string> = {
  invalid_mode: 'Steam returned an unexpected response.',
  invalid_claimed_id: 'Steam did not return a valid SteamID.',
  verify_request_failed: 'Could not verify Steam response. Try again.',
  is_valid_false: 'Steam rejected the response signature.',
  already_linked: 'That Steam account is already linked to another user.',
};

type SearchParams = Promise<{ steam_error?: string; linked?: string }>;

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { user } = await requireUser();

  let steamPersona = user.steamPersona;
  let steamAvatar = user.steamAvatar;
  if (user.steamId64 && (!steamPersona || !steamAvatar)) {
    const summary = await fetchSteamSummary(user.steamId64);
    if (summary) {
      steamPersona = summary.personaName;
      steamAvatar = summary.avatarUrl;
    }
  }

  const errMessage = params.steam_error ? STEAM_ERRORS[params.steam_error] ?? 'Steam linking failed.' : null;
  const successMessage = params.linked === 'steam' ? 'Steam account linked.' : null;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="mt-1 text-white/40">
          Tell people about yourself and link your game accounts.
        </p>
      </div>

      {errMessage && <ErrorBanner kind="error">{errMessage}</ErrorBanner>}
      {successMessage && <ErrorBanner kind="success">{successMessage}</ErrorBanner>}

      <Card className="border-[#1a1a2e] bg-[#0d0d14]">
        <CardHeader>
          <CardTitle className="text-white">About you</CardTitle>
          <CardDescription className="text-white/40">
            Display name and bio shown to other users.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            defaultDisplayName={user.displayName ?? ''}
            defaultBio={user.bio ?? ''}
          />
        </CardContent>
      </Card>

      <Card className="border-[#1a1a2e] bg-[#0d0d14]">
        <CardHeader>
          <CardTitle className="text-white">Minecraft</CardTitle>
          <CardDescription className="text-white/40">
            We verify the username via the Mojang API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MinecraftField
            defaultUsername={user.minecraftName ?? ''}
            defaultUuid={user.minecraftUuid}
          />
        </CardContent>
      </Card>

      <Card className="border-[#1a1a2e] bg-[#0d0d14]">
        <CardHeader>
          <CardTitle className="text-white">Steam</CardTitle>
          <CardDescription className="text-white/40">
            Link via Steam OpenID to prove ownership of your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SteamLinkCard
            steamId64={user.steamId64}
            persona={steamPersona}
            avatarUrl={steamAvatar}
          />
        </CardContent>
      </Card>
    </div>
  );
}
