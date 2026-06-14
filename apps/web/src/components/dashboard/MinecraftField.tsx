import { useEffect, useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { fetchMinecraftLookup } from '../../lib/minecraft-lookup';

type Props = { defaultUsername: string; defaultUuid: string | null };
type ServerResult =
  | { for: string; ok: true; uuid: string; name: string }
  | { for: string; ok: false; error: string };
type Lookup =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; uuid: string; name: string }
  | { state: 'err'; message: string };

const FORMAT_RE = /^[A-Za-z0-9_]{3,16}$/;

function deriveLookup(trimmed: string, server: ServerResult | null): Lookup {
  if (trimmed === '') return { state: 'idle' };
  if (!FORMAT_RE.test(trimmed)) return { state: 'err', message: 'Letters, numbers, underscores; 3–16 chars.' };
  if (server && server.for === trimmed) {
    return server.ok ? { state: 'ok', uuid: server.uuid, name: server.name } : { state: 'err', message: server.error };
  }
  return { state: 'checking' };
}

function StatusIcon({ state }: { state: Lookup['state'] }) {
  if (state === 'checking') return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Checking" />;
  if (state === 'ok') return <Check className="size-4 text-success" aria-label="Valid" />;
  if (state === 'err') return <X className="size-4 text-destructive" aria-label="Invalid" />;
  return <span className="size-4" aria-hidden />;
}

export default function MinecraftField({ defaultUsername, defaultUuid }: Props) {
  const [value, setValue] = useState(defaultUsername);
  const [serverResult, setServerResult] = useState<ServerResult | null>(
    defaultUsername && defaultUuid
      ? { for: defaultUsername, ok: true, uuid: defaultUuid, name: defaultUsername }
      : null,
  );
  const [pending, setPending] = useState(false);
  const [isLinked, setIsLinked] = useState<boolean>(Boolean(defaultUuid));

  useEffect(() => {
    const v = value.trim();
    if (v === '' || !FORMAT_RE.test(v)) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const outcome = await fetchMinecraftLookup(v);
      if (cancelled) return;
      setServerResult(
        outcome.ok
          ? { for: v, ok: true, uuid: outcome.uuid, name: outcome.name }
          : { for: v, ok: false, error: outcome.message },
      );
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [value]);

  const trimmed = value.trim();
  const lookup = deriveLookup(trimmed, serverResult);
  const avatarName =
    lookup.state === 'ok' ? lookup.name : trimmed === defaultUsername && defaultUuid ? defaultUsername : null;

  async function persist(username: string): Promise<{ ok: boolean; error?: string }> {
    setPending(true);
    try {
      const res = await fetch('/api/profile/minecraft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      return (await res.json()) as { ok: boolean; error?: string };
    } catch {
      return { ok: false, error: 'upstream' };
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const r = await persist(trimmed);
    if (r.ok) { setIsLinked(true); toast.success('Minecraft account linked.'); }
    else if (r.error === 'taken') toast.error('That Minecraft account is already linked to another user.');
    else if (r.error === 'upstream') toast.error("Couldn't reach Minecraft. Try again.");
    else toast.error('Could not link account.');
  }

  async function handleUnlink() {
    const r = await persist('');
    if (r.ok) { setValue(''); setServerResult(null); setIsLinked(false); toast.success('Minecraft account unlinked.'); }
    else toast.error('Could not unlink.');
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <Label htmlFor="username" className="text-muted-foreground">Minecraft username</Label>
      <div className="flex items-center gap-3">
        {avatarName ? (
          <img
            src={`https://minotar.net/avatar/${encodeURIComponent(avatarName)}/96`}
            alt=""
            width={48}
            height={48}
            className="size-12 rounded-md ring-1 ring-border"
          />
        ) : (
          <div className="size-12 rounded-md bg-muted" aria-hidden />
        )}
        <div className="flex flex-1 items-center gap-2">
          <Input
            id="username"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Notch"
            maxLength={16}
            className="bg-background text-foreground"
          />
          <StatusIcon state={lookup.state} />
        </div>
      </div>
      <div className="min-h-5 text-xs">
        {lookup.state === 'ok' && <span className="text-success">Verified as {lookup.name}.</span>}
        {lookup.state === 'err' && <span className="text-destructive">{lookup.message}</span>}
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending || lookup.state === 'checking' || lookup.state === 'err' || lookup.state === 'idle'}
        >
          {pending ? 'Saving…' : 'Link Minecraft account'}
        </Button>
        {isLinked && (
          <Button type="button" variant="outline" disabled={pending} onClick={handleUnlink}>Unlink</Button>
        )}
      </div>
    </form>
  );
}
