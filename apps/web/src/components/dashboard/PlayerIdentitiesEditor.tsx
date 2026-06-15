import { useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { PLAYER_IDENTITY_KINDS, type PlayerIdentityKind } from '@voz/shared';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';

type Identity = { kind: PlayerIdentityKind; identityKey: string; displayName: string | null };
type Props = { playerId: string; identities: Identity[] };

export default function PlayerIdentitiesEditor({ playerId, identities }: Props) {
  const [kind, setKind] = useState<PlayerIdentityKind>('minecraft');
  const [identityKey, setIdentityKey] = useState('');
  const [pending, setPending] = useState(false);

  async function mutate(method: 'POST' | 'DELETE', payload: { kind: string; identityKey: string }) {
    setPending(true);
    try {
      const res = await fetch(`/api/players/${playerId}/identities`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (r.ok) {
        location.reload();
      } else {
        toast.error(r.error ?? 'Could not update identities.');
        setPending(false);
      }
    } catch {
      toast.error('Could not update identities.');
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <ul className="grid gap-1">
        {identities.length === 0 && <li className="text-sm text-muted-foreground">No identities.</li>}
        {identities.map((i) => (
          <li key={`${i.kind}:${i.identityKey}`} className="flex items-center gap-2 text-sm">
            <span className="rounded bg-muted px-2 py-0.5">{i.kind}</span>
            <span className="font-mono text-muted-foreground">{i.displayName ?? i.identityKey}</span>
            <button
              type="button"
              aria-label={`Remove ${i.kind} identity`}
              disabled={pending}
              onClick={() => mutate('DELETE', { kind: i.kind, identityKey: i.identityKey })}
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <div className="grid gap-1">
          <Select value={kind} onValueChange={(v) => setKind(v as PlayerIdentityKind)}>
            <SelectTrigger className="w-36" aria-label="Identity kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAYER_IDENTITY_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input value={identityKey} onChange={(e) => setIdentityKey(e.target.value)} placeholder="Identity key (UUID, SteamID…)" className="flex-1" aria-label="Identity key" />
        <Button type="button" disabled={pending || !identityKey.trim()} onClick={() => mutate('POST', { kind, identityKey })}>
          Add
        </Button>
      </div>
    </div>
  );
}
