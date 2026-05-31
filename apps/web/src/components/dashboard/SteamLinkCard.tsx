import { useState } from 'react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';

type Props = { steamId64: string | null; persona: string | null; avatarUrl: string | null };

export default function SteamLinkCard({ steamId64, persona, avatarUrl }: Props) {
  const [pending, setPending] = useState(false);

  async function handleUnlink() {
    setPending(true);
    const res = await fetch('/api/profile/steam/unlink', { method: 'POST' });
    setPending(false);
    if (res.ok) { toast.success('Steam account unlinked.'); location.reload(); }
    else toast.error('Could not unlink Steam.');
  }

  if (!steamId64) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border bg-muted p-4">
        <div>
          <p className="text-sm text-foreground">Steam not linked</p>
          <p className="text-xs text-muted-foreground">Link your Steam account to verify ownership of your Steam ID.</p>
        </div>
        <a href="/api/auth/steam/initiate" className={cn(buttonVariants())}>Link Steam</a>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-muted p-4">
      <div className="flex items-center gap-3">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" width={48} height={48} className="size-12 rounded-md ring-1 ring-border" />
        ) : (
          <div className="size-12 rounded-md bg-muted" aria-hidden />
        )}
        <div>
          <p className="text-sm text-foreground">{persona || 'Steam linked'}</p>
          <p className="font-mono text-xs text-muted-foreground">SteamID64: {steamId64}</p>
        </div>
      </div>
      <Button type="button" variant="outline" disabled={pending} onClick={handleUnlink}>
        {pending ? 'Unlinking…' : 'Unlink'}
      </Button>
    </div>
  );
}
