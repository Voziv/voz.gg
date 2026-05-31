import { useState } from 'react';
import { toast } from 'sonner';
import { Terminal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';

type Props = { serverId: string; serverName: string; initialToken?: string };

function installCommand(token: string): string {
  return `curl -fsSL ${location.origin}/install-agent.sh | sh -s -- ${token}`;
}

export default function AgentInstallDialog({ serverId, serverName, initialToken }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<string | null>(initialToken ?? null);

  async function regenerate() {
    setPending(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/agent/regenerate`, { method: 'POST' });
      const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; enrollmentToken?: string };
      if (r.ok && r.enrollmentToken) {
        setToken(r.enrollmentToken);
        toast.success('New enrollment token generated.');
      } else {
        toast.error('Could not regenerate token.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={`Install command for ${serverName}`}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
      >
        <Terminal size={16} />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agent install</DialogTitle>
          <DialogDescription>
            Run this on the box hosting {serverName}. The token is shown only once — regenerate if you lose it.
          </DialogDescription>
        </DialogHeader>
        {token ? (
          <pre className="overflow-x-auto rounded-md border border-input bg-muted p-3 text-xs text-foreground">
            {installCommand(token)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            The token is stored hashed and cannot be shown again. Generate a new one to install.
          </p>
        )}
        <DialogFooter showCloseButton>
          <Button type="button" variant="outline" disabled={pending} onClick={regenerate}>
            {pending ? 'Generating…' : 'Regenerate token'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
