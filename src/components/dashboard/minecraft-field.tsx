'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  lookupMinecraftAction,
  setMinecraftUsername,
} from '@/app/dashboard/profile/actions';

type Props = {
  defaultUsername: string;
  defaultUuid: string | null;
};

type ServerResult =
  | { for: string; ok: true; uuid: string; name: string }
  | { for: string; ok: false; error: string };

const FORMAT_RE = /^[A-Za-z0-9_]{3,16}$/;

export function MinecraftField({ defaultUsername, defaultUuid }: Props) {
  const [value, setValue] = useState(defaultUsername);
  const [serverResult, setServerResult] = useState<ServerResult | null>(
    defaultUsername && defaultUuid
      ? { for: defaultUsername, ok: true, uuid: defaultUuid, name: defaultUsername }
      : null,
  );
  const [savePending, startSave] = useTransition();

  useEffect(() => {
    const v = value.trim();
    if (v === '' || !FORMAT_RE.test(v)) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const r = await lookupMinecraftAction(v);
      if (cancelled) return;
      if (r.ok) setServerResult({ for: v, ok: true, uuid: r.uuid, name: r.name });
      else setServerResult({ for: v, ok: false, error: r.error });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value]);

  const trimmed = value.trim();
  const lookup = deriveLookup(trimmed, serverResult);

  const avatarUuid =
    lookup.state === 'ok'
      ? lookup.uuid
      : trimmed === defaultUsername && defaultUuid
        ? defaultUuid
        : null;

  function handleSave(formData: FormData) {
    startSave(async () => {
      const r = await setMinecraftUsername(null, formData);
      if (r.ok) toast.success(r.message ?? 'Saved.');
      else toast.error(r.error);
    });
  }

  function handleUnlink() {
    startSave(async () => {
      const fd = new FormData();
      fd.set('username', '');
      const r = await setMinecraftUsername(null, fd);
      if (r.ok) {
        setValue('');
        setServerResult(null);
        toast.success(r.message ?? 'Unlinked.');
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <form action={handleSave} className="grid gap-3">
      <Label htmlFor="username" className="text-white/70">
        Minecraft username
      </Label>
      <div className="flex items-center gap-3">
        {avatarUuid ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://crafatar.com/avatars/${avatarUuid}?size=48&overlay`}
            alt=""
            width={48}
            height={48}
            className="size-12 rounded-md ring-1 ring-[#1a1a2e]"
          />
        ) : (
          <div className="size-12 rounded-md bg-[#1a1a2e]" aria-hidden />
        )}
        <div className="flex flex-1 items-center gap-2">
          <Input
            id="username"
            name="username"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Notch"
            maxLength={16}
            className="bg-[#0a0a0f] text-white"
          />
          <StatusIcon state={lookup.state} />
        </div>
      </div>
      <div className="min-h-5 text-xs">
        {lookup.state === 'ok' && (
          <span className="text-emerald-400">Verified as {lookup.name}.</span>
        )}
        {lookup.state === 'err' && <span className="text-red-400">{lookup.message}</span>}
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={savePending || lookup.state === 'checking' || lookup.state === 'err' || lookup.state === 'idle'}
        >
          {savePending ? 'Saving…' : 'Link Minecraft account'}
        </Button>
        {defaultUuid && (
          <Button type="button" variant="outline" disabled={savePending} onClick={handleUnlink}>
            Unlink
          </Button>
        )}
      </div>
    </form>
  );
}

type Lookup =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; uuid: string; name: string }
  | { state: 'err'; message: string };

function deriveLookup(trimmed: string, server: ServerResult | null): Lookup {
  if (trimmed === '') return { state: 'idle' };
  if (!FORMAT_RE.test(trimmed)) {
    return { state: 'err', message: 'Letters, numbers, underscores; 3–16 chars.' };
  }
  if (server && server.for === trimmed) {
    return server.ok
      ? { state: 'ok', uuid: server.uuid, name: server.name }
      : { state: 'err', message: server.error };
  }
  return { state: 'checking' };
}

function StatusIcon({ state }: { state: Lookup['state'] }) {
  if (state === 'checking') {
    return <Loader2 className="size-4 animate-spin text-white/40" aria-label="Checking" />;
  }
  if (state === 'ok') {
    return <Check className="size-4 text-emerald-400" aria-label="Valid" />;
  }
  if (state === 'err') {
    return <X className="size-4 text-red-400" aria-label="Invalid" />;
  }
  return <span className="size-4" aria-hidden />;
}
