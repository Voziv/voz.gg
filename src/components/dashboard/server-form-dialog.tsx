'use client';

import { useState, useTransition } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GAME_TYPES, type Server } from '@/db/schema';
import { createServer, updateServer } from '@/app/dashboard/servers/actions';

const GAME_LABELS: Record<string, string> = {
  'minecraft-java': 'Minecraft (Java)',
  'minecraft-bedrock': 'Minecraft (Bedrock)',
  source: 'Source engine',
  'generic-tcp': 'Generic TCP',
  unknown: 'Unknown / Other',
};

type ButtonStyleProps = VariantProps<typeof buttonVariants>;

type Props = {
  children: React.ReactNode;
  triggerVariant?: ButtonStyleProps['variant'];
  triggerSize?: ButtonStyleProps['size'];
  triggerAriaLabel?: string;
  server?: Server;
};

export function ServerFormDialog({
  children,
  triggerVariant,
  triggerSize,
  triggerAriaLabel,
  server,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const isEdit = !!server;

  function handleSubmit(formData: FormData) {
    start(async () => {
      const r = isEdit
        ? await updateServer(server!.id, null, formData)
        : await createServer(null, formData);
      if (r.ok) {
        toast.success(r.message ?? 'Saved.');
        setOpen(false);
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={triggerAriaLabel}
        className={cn(buttonVariants({ variant: triggerVariant, size: triggerSize }))}
      >
        {children}
      </DialogTrigger>
      <DialogContent className="bg-[#0d0d14] text-white ring-[#1a1a2e]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit server' : 'Add server'}</DialogTitle>
          <DialogDescription>
            Connection details and game type are visible to all signed-in users.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name" className="text-white/70">
              Name
            </Label>
            <Input
              id="name"
              name="name"
              defaultValue={server?.name ?? ''}
              required
              maxLength={80}
              className="bg-[#0a0a0f] text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="gameType" className="text-white/70">
                Game type
              </Label>
              <select
                id="gameType"
                name="gameType"
                defaultValue={server?.gameType ?? 'minecraft-java'}
                className="rounded-md border border-input bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {GAME_TYPES.map((g) => (
                  <option key={g} value={g}>
                    {GAME_LABELS[g] ?? g}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port" className="text-white/70">
                Port
              </Label>
              <Input
                id="port"
                name="port"
                type="number"
                min={1}
                max={65535}
                defaultValue={server?.port ?? 25565}
                required
                className="bg-[#0a0a0f] text-white"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="host" className="text-white/70">
              Host (IP or DNS name)
            </Label>
            <Input
              id="host"
              name="host"
              defaultValue={server?.host ?? ''}
              required
              maxLength={253}
              placeholder="mc.example.com"
              className="bg-[#0a0a0f] text-white"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description" className="text-white/70">
              Description
            </Label>
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
