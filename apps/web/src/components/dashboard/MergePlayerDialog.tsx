import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Merge } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';

type SearchResult = { id: string; displayName: string | null; minecraftName: string | null };
type Props = { playerId: string };

export default function MergePlayerDialog({ playerId }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; players?: SearchResult[] };
        setResults((r.ok && r.players ? r.players : []).filter((p) => p.id !== playerId));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setResults([]);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      controller.abort();
    };
  }, [query, playerId]);

  async function merge(absorbedId: string, label: string) {
    if (!confirm(`Merge "${label}" into this player? This deletes the absorbed player.`)) return;
    setPending(true);
    try {
      const res = await fetch(`/api/players/${playerId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ absorbedId }),
      });
      const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (r.ok) {
        toast.success('Players merged.');
        location.reload();
      } else {
        toast.error(r.error ?? 'Could not merge players.');
        setPending(false);
      }
    } catch {
      toast.error('Could not merge players.');
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={cn(buttonVariants({ variant: 'outline' }), 'gap-2')}>
        <Merge size={16} /> Merge another player
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge a player into this one</DialogTitle>
          <DialogDescription>
            The player you pick is absorbed: its identities, groups, and notes move here and it is deleted.
          </DialogDescription>
        </DialogHeader>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search players…" autoFocus />
        <ul className="max-h-64 overflow-y-auto">
          {results.map((p) => {
            const label = p.displayName ?? p.minecraftName ?? p.id;
            return (
              <li key={p.id} className="flex items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
                <span>
                  {label}
                  {p.minecraftName && p.minecraftName !== label && (
                    <span className="ml-2 text-muted-foreground">{p.minecraftName}</span>
                  )}
                </span>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => merge(p.id, label)}>
                  Merge
                </Button>
              </li>
            );
          })}
          {query.trim() && results.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">No matches.</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
