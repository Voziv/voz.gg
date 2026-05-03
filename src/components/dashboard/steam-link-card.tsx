'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { unlinkSteam } from '@/app/dashboard/profile/actions';

type Props = {
  steamId64: string | null;
  persona: string | null;
  avatarUrl: string | null;
};

export function SteamLinkCard({ steamId64, persona, avatarUrl }: Props) {
  const [pending, start] = useTransition();

  function handleUnlink() {
    start(async () => {
      const r = await unlinkSteam();
      if (r.ok) toast.success(r.message ?? 'Unlinked.');
      else toast.error(r.error);
    });
  }

  if (!steamId64) {
    return (
      <div className="flex items-center justify-between rounded-md border border-[#1a1a2e] bg-[#0a0a0f] p-4">
        <div>
          <p className="text-sm text-white">Steam not linked</p>
          <p className="text-xs text-white/40">
            Link your Steam account to verify ownership of your Steam ID.
          </p>
        </div>
        <Button render={<a href="/api/auth/steam/initiate" />} nativeButton={false}>
          Link Steam
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-[#1a1a2e] bg-[#0a0a0f] p-4">
      <div className="flex items-center gap-3">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            width={48}
            height={48}
            className="size-12 rounded-md ring-1 ring-[#1a1a2e]"
          />
        ) : (
          <div className="size-12 rounded-md bg-[#1a1a2e]" aria-hidden />
        )}
        <div>
          <p className="text-sm text-white">{persona || 'Steam linked'}</p>
          <p className="font-mono text-xs text-white/40">SteamID64: {steamId64}</p>
        </div>
      </div>
      <Button type="button" variant="outline" disabled={pending} onClick={handleUnlink}>
        {pending ? 'Unlinking…' : 'Unlink'}
      </Button>
    </div>
  );
}
