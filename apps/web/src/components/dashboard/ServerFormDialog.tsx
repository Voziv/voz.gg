import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';
import { GAME_TYPES, type GameType } from '@voz/shared';

const GAME_LABELS: Record<GameType, string> = {
  'minecraft-java': 'Minecraft (Java)',
  'minecraft-bedrock': 'Minecraft (Bedrock)',
  source: 'Source engine',
  'generic-tcp': 'Generic TCP',
  unknown: 'Unknown / Other',
};

type ServerData = {
  id: string;
  name: string;
  gameType: GameType;
  host: string;
  port: number;
  description: string | null;
};
type Props = { server?: ServerData };

export default function ServerFormDialog({ server }: Props) {
  const isEdit = !!server;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get('name'),
      gameType: form.get('gameType'),
      host: form.get('host'),
      port: form.get('port'),
      description: form.get('description'),
    };
    const res = await fetch(isEdit ? `/api/servers/${server!.id}` : '/api/servers', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
    setPending(false);
    if (r.ok) {
      toast.success(isEdit ? 'Server updated.' : 'Server created.');
      setOpen(false);
      location.reload();
    } else {
      toast.error(r.error ?? 'Could not save server.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={isEdit ? `Edit ${server!.name}` : undefined}
        className={cn(buttonVariants(isEdit ? { variant: 'ghost', size: 'icon' } : {}))}
      >
        {isEdit ? (
          <Pencil size={16} />
        ) : (
          <>
            <Plus size={16} />
            Add server
          </>
        )}
      </DialogTrigger>
      <DialogContent className="bg-[#0d0d14] text-white ring-[#1a1a2e]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit server' : 'Add server'}</DialogTitle>
          <DialogDescription>
            Connection details and game type are visible to all signed-in users.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name" className="text-white/70">Name</Label>
            <Input id="name" name="name" defaultValue={server?.name ?? ''} required maxLength={80} className="bg-[#0a0a0f] text-white" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="gameType" className="text-white/70">Game type</Label>
              <select
                id="gameType"
                name="gameType"
                defaultValue={server?.gameType ?? 'minecraft-java'}
                className="rounded-md border border-input bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {GAME_TYPES.map((g) => (
                  <option key={g} value={g}>{GAME_LABELS[g] ?? g}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port" className="text-white/70">Port</Label>
              <Input id="port" name="port" type="number" min={1} max={65535} defaultValue={server?.port ?? 25565} required className="bg-[#0a0a0f] text-white" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="host" className="text-white/70">Host (IP or DNS name)</Label>
            <Input id="host" name="host" defaultValue={server?.host ?? ''} required maxLength={253} placeholder="mc.example.com" className="bg-[#0a0a0f] text-white" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description" className="text-white/70">Description</Label>
            <textarea
              id="description"
              name="description"
              defaultValue={server?.description ?? ''}
              maxLength={500}
              rows={3}
              className="rounded-md border border-input bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
